import { createFile, DataStream } from "mp4box";
import type {
  MP4File,
  MP4Info,
  MP4Sample,
  MP4ArrayBuffer,
  MP4VideoTrack,
  MP4AudioTrack,
} from "mp4box";

export const AUDIO_STREAM_TYPE = 0;
export const VIDEO_STREAM_TYPE = 1;

export type StreamType = typeof AUDIO_STREAM_TYPE | typeof VIDEO_STREAM_TYPE;

export interface VideoDecoderConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  displayAspectWidth?: number;
  displayAspectHeight?: number;
  description?: Uint8Array;
}

export interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: Uint8Array;
}

export type DecoderConfig = VideoDecoderConfig | AudioDecoderConfig;

interface PendingReadResolver {
  resolve: (sample: MP4Sample) => void;
  reject: (error: Error) => void;
}

export class MP4Demuxer {
  private fileUri: string;
  private file: MP4File | null = null;
  private info: MP4Info | null = null;
  private videoTrack: MP4VideoTrack | null = null;
  private audioTrack: MP4AudioTrack | null = null;
  private selectedTrack: MP4VideoTrack | MP4AudioTrack | null = null;
  private streamType: StreamType = VIDEO_STREAM_TYPE;
  private readySamples: MP4Sample[] = [];
  private pendingReadResolver: PendingReadResolver | null = null;
  private infoResolver: ((info: MP4Info) => void) | null = null;
  private fetchAbortController: AbortController | null = null;
  private isEOF = false;
  private totalSamplesReceived = 0;
  private onSamplesCallCount = 0;

  constructor(fileUri: string) {
    this.fileUri = fileUri;
  }

  async initialize(streamType: StreamType): Promise<void> {
    this.streamType = streamType;
    this.readySamples = [];
    this.pendingReadResolver = null;
    this.isEOF = false;

    // Pass streamType so track can be selected in onReady while data is still streaming
    await this.fetchAndParse(streamType);

    // Verify track was selected in onReady
    if (!this.selectedTrack) {
      throw new Error(
        `No ${streamType === AUDIO_STREAM_TYPE ? "audio" : "video"} track found`
      );
    }
  }

  private async fetchAndParse(streamType: StreamType): Promise<void> {
    this.file = createFile();

    this.file.onError = (e: string) => {
      console.error("MP4Box error:", e);
    };

    this.file.onReady = (info: MP4Info) => {
      this.info = info;
      this.videoTrack = info.videoTracks[0] || null;
      this.audioTrack = info.audioTracks[0] || null;

      // Select track and start extraction HERE, while data is still streaming
      // This matches the W3C WebCodecs sample pattern
      const track =
        streamType === AUDIO_STREAM_TYPE ? this.audioTrack : this.videoTrack;
      if (track && !this.selectedTrack) {
        this.selectedTrack = track;
        this.file?.setExtractionOptions(track.id);
        this.file?.start();
      }

      if (this.infoResolver) {
        this.infoResolver(info);
        this.infoResolver = null;
      }
    };

    this.file.onSamples = (
      _trackId: number,
      _user: unknown,
      samples: MP4Sample[]
    ) => {
      this.onSamples(samples);
    };

    this.fetchAbortController = new AbortController();

    const response = await fetch(this.fileUri, {
      signal: this.fetchAbortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get response body reader");
    }

    let offset = 0;
    const infoPromise = new Promise<MP4Info>((resolve) => {
      this.infoResolver = resolve;
    });

    const processChunk = async (): Promise<void> => {
      const { done, value } = await reader.read();

      if (done) {
        this.file?.flush();
        this.isEOF = true;
        return;
      }

      const buffer = value.buffer as MP4ArrayBuffer;
      buffer.fileStart = offset;
      offset += buffer.byteLength;

      this.file?.appendBuffer(buffer);

      if (!this.info) {
        return processChunk();
      }
    };

    await processChunk();
    await infoPromise;

    const continueReading = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.file?.flush();
          this.isEOF = true;
          if (this.selectedTrack) {
            this.file?.start();
          }
          break;
        }

        const buffer = value.buffer as MP4ArrayBuffer;
        buffer.fileStart = offset;
        offset += buffer.byteLength;
        this.file?.appendBuffer(buffer);
        if (this.selectedTrack) {
          this.file?.start();
        }
      }
    };

    continueReading().catch(console.error);
  }

  getDecoderConfig(): DecoderConfig {
    if (this.streamType === AUDIO_STREAM_TYPE && this.audioTrack) {
      return {
        codec: this.audioTrack.codec,
        sampleRate: this.audioTrack.audio.sample_rate,
        numberOfChannels: this.audioTrack.audio.channel_count,
        description: this.getAudioSpecificConfig(),
      };
    } else if (this.videoTrack) {
      let codec = this.videoTrack.codec;
      if (codec.startsWith("vp08")) {
        codec = "vp8";
      }

      return {
        codec,
        codedWidth: this.videoTrack.video.width,
        codedHeight: this.videoTrack.video.height,
        displayAspectWidth: this.videoTrack.track_width,
        displayAspectHeight: this.videoTrack.track_height,
        description: this.getDescriptionData(),
      };
    }

    throw new Error("No track selected");
  }

  getVideoInfo(): { width: number; height: number; duration: number } | null {
    if (!this.videoTrack || !this.info) return null;

    return {
      width: this.videoTrack.video.width,
      height: this.videoTrack.video.height,
      duration: this.info.duration / this.info.timescale,
    };
  }

  getAudioInfo(): {
    sampleRate: number;
    channelCount: number;
    duration: number;
  } | null {
    if (!this.audioTrack || !this.info) return null;

    return {
      sampleRate: this.audioTrack.audio.sample_rate,
      channelCount: this.audioTrack.audio.channel_count,
      duration: this.info.duration / this.info.timescale,
    };
  }

  getDuration(): number {
    if (!this.info) return 0;
    return this.info.duration / this.info.timescale;
  }

  async getNextChunk(): Promise<EncodedVideoChunk | EncodedAudioChunk | null> {
    const sample = await this.readSample();
    if (!sample) return null;

    const type = sample.is_sync ? "key" : "delta";
    const timestamp = (sample.cts * 1_000_000) / sample.timescale;
    const duration = (sample.duration * 1_000_000) / sample.timescale;

    if (this.streamType === AUDIO_STREAM_TYPE) {
      return new EncodedAudioChunk({
        type,
        timestamp,
        duration,
        data: sample.data,
      });
    } else {
      return new EncodedVideoChunk({
        type,
        timestamp,
        duration,
        data: sample.data,
      });
    }
  }

  seek(timeInSeconds: number): void {
    if (!this.file) return;

    this.readySamples = [];
    this.file.seek(timeInSeconds, true);
    this.file.start();
  }

  stop(): void {
    this.file?.stop();
    this.fetchAbortController?.abort();
  }

  private selectTrack(track: MP4VideoTrack | MP4AudioTrack): void {
    if (this.selectedTrack) {
      throw new Error("Changing tracks is not implemented");
    }

    this.selectedTrack = track;
    this.file?.setExtractionOptions(track.id);
    this.file?.start();
  }

  private async readSample(): Promise<MP4Sample | null> {
    if (!this.selectedTrack) {
      throw new Error("No track selected");
    }

    if (this.readySamples.length > 0) {
      return this.readySamples.shift()!;
    }

    if (this.isEOF) {
      this.file?.start();
      if (this.readySamples.length > 0) {
        return this.readySamples.shift()!;
      }
      return null;
    }

    return new Promise((resolve, reject) => {
      this.pendingReadResolver = { resolve, reject };
      this.file?.start();
    });
  }

  private onSamples(samples: MP4Sample[]): void {
    const SAMPLE_BUFFER_TARGET_SIZE = 50;

    this.onSamplesCallCount++;
    this.totalSamplesReceived += samples.length;
    this.readySamples.push(...samples);

    if (this.readySamples.length >= SAMPLE_BUFFER_TARGET_SIZE) {
      this.file?.stop();
    }

    if (this.pendingReadResolver && this.readySamples.length > 0) {
      this.pendingReadResolver.resolve(this.readySamples.shift()!);
      this.pendingReadResolver = null;
    }
  }

  getDebugInfo(): {
    trackId: number | null;
    trackType: string;
    samplesReceived: number;
    onSamplesCallCount: number;
    readySamplesLength: number;
    isEOF: boolean;
  } {
    return {
      trackId: this.selectedTrack?.id ?? null,
      trackType: this.streamType === AUDIO_STREAM_TYPE ? "audio" : "video",
      samplesReceived: this.totalSamplesReceived,
      onSamplesCallCount: this.onSamplesCallCount,
      readySamplesLength: this.readySamples.length,
      isEOF: this.isEOF,
    };
  }

  private getDescriptionData(): Uint8Array | undefined {
    if (!this.file || !this.videoTrack) return undefined;

    try {
      const trak = this.file.getTrackById(this.videoTrack.id);
      if (!trak) return undefined;

      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
          const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
          box.write(stream);
          return new Uint8Array(stream.buffer, 8);
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private getAudioSpecificConfig(): Uint8Array | undefined {
    if (!this.file || !this.audioTrack) return undefined;

    try {
      const trak = this.file.getTrackById(this.audioTrack.id);
      if (!trak) return undefined;

      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        if (!entry?.esds) continue;

        const descs = entry.esds.esd.descs;
        if (!descs || descs.length === 0) continue;

        const decoderConfigDesc = descs[0];
        if (decoderConfigDesc.tag !== 0x04) continue;

        const decSpecificInfoDesc = decoderConfigDesc.descs?.[0];
        if (!decSpecificInfoDesc || decSpecificInfoDesc.tag !== 0x05) continue;

        return decSpecificInfoDesc.data;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
