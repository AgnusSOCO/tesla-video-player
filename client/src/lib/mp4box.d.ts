declare module "mp4box" {
  export function createFile(): MP4File;

  export class DataStream {
    constructor(
      arrayBuffer?: ArrayBuffer,
      byteOffset?: number,
      endianness?: boolean
    );
    static BIG_ENDIAN: boolean;
    static LITTLE_ENDIAN: boolean;
    buffer: ArrayBuffer;
  }

  export interface MP4MediaTrack {
    id: number;
    created: Date;
    modified: Date;
    movie_duration: number;
    layer: number;
    alternate_group: number;
    volume: number;
    track_width: number;
    track_height: number;
    timescale: number;
    duration: number;
    bitrate: number;
    codec: string;
    language: string;
    nb_samples: number;
  }

  export interface MP4VideoTrack extends MP4MediaTrack {
    video: {
      width: number;
      height: number;
    };
  }

  export interface MP4AudioTrack extends MP4MediaTrack {
    audio: {
      sample_rate: number;
      channel_count: number;
      sample_size: number;
    };
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    fragment_duration: number;
    isFragmented: boolean;
    isProgressive: boolean;
    hasIOD: boolean;
    brands: string[];
    created: Date;
    modified: Date;
    tracks: MP4MediaTrack[];
    videoTracks: MP4VideoTrack[];
    audioTracks: MP4AudioTrack[];
  }

  export interface MP4Sample {
    number: number;
    track_id: number;
    timescale: number;
    description_index: number;
    description: {
      avcC?: MP4BoxDescription;
      hvcC?: MP4BoxDescription;
      vpcC?: MP4BoxDescription;
      av1C?: MP4BoxDescription;
    };
    data: ArrayBuffer;
    size: number;
    alreadyRead: number;
    duration: number;
    cts: number;
    dts: number;
    is_sync: boolean;
    is_leading: number;
    depends_on: number;
    is_depended_on: number;
    has_redundancy: number;
    degradation_priority: number;
    offset: number;
  }

  export interface MP4BoxDescription {
    write(stream: DataStream): void;
  }

  export interface MP4Trak {
    mdia: {
      minf: {
        stbl: {
          stsd: {
            entries: Array<{
              avcC?: MP4BoxDescription;
              hvcC?: MP4BoxDescription;
              vpcC?: MP4BoxDescription;
              av1C?: MP4BoxDescription;
              esds?: {
                esd: {
                  descs: Array<{
                    tag: number;
                    oti?: number;
                    descs?: Array<{
                      tag: number;
                      data: Uint8Array;
                    }>;
                  }>;
                };
              };
            }>;
          };
        };
      };
    };
  }

  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export interface MP4File {
    onMoovStart?: () => void;
    onReady?: (info: MP4Info) => void;
    onError?: (e: string) => void;
    onSamples?: (id: number, user: unknown, samples: MP4Sample[]) => void;

    appendBuffer(data: MP4ArrayBuffer): number;
    start(): void;
    stop(): void;
    flush(): void;
    setExtractionOptions(
      trackId: number,
      user?: unknown,
      options?: { nbSamples?: number; rapAlignement?: boolean }
    ): void;
    unsetExtractionOptions(trackId: number): void;
    seek(time: number, useRap?: boolean): { offset: number; time: number };
    getTrackById(trackId: number): MP4Trak | undefined;

    moov?: {
      traks: Array<{
        mdia: {
          minf: {
            stbl: {
              stsd: {
                entries: Array<{
                  avcC?: MP4BoxDescription;
                  hvcC?: MP4BoxDescription;
                  vpcC?: MP4BoxDescription;
                  av1C?: MP4BoxDescription;
                  esds?: {
                    esd: {
                      descs: Array<{
                        tag: number;
                        oti?: number;
                        descs?: Array<{
                          tag: number;
                          data: Uint8Array;
                        }>;
                      }>;
                    };
                  };
                }>;
              };
            };
          };
        };
      }>;
    };
  }
}
