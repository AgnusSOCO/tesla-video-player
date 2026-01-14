import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Loader2,
  SkipBack,
  SkipForward,
} from "lucide-react";
import {
  MP4Demuxer,
  AUDIO_STREAM_TYPE,
  VIDEO_STREAM_TYPE,
  VideoDecoderConfig,
  AudioDecoderConfig,
} from "@/lib/mp4-demuxer";

interface WebCodecsVideoPlayerProps {
  videoUrl: string;
  title?: string;
  onClose?: () => void;
}

interface PlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  buffering: boolean;
}

interface DebugState {
  videoDecoderState: string;
  audioDecoderState: string;
  frameBufferSize: number;
  audioBufferSize: number;
  chunksDecoded: number;
  framesRendered: number;
  droppedFrames: number; // Track dropped frames for performance monitoring
  lastError: string | null;
  demuxerReady: boolean;
  videoSamplesReceived: number;
  audioSamplesReceived: number;
  videoTrackId: number | null;
  audioTrackId: number | null;
  videoIsEOF: boolean;
  audioIsEOF: boolean;
}

// Performance tuning constants - conservative values for stability
const FRAME_BUFFER_TARGET_SIZE = 30; // ~1 second at 30fps - enough for smooth playback
const FRAME_BUFFER_MAX_SIZE = 60; // Hard limit to prevent memory issues
const AUDIO_SCHEDULE_AHEAD = 1.0; // Schedule 1 second of audio ahead - enough for smooth playback
const DEBUG_UPDATE_INTERVAL = 500; // Update debug panel every 500ms instead of every frame
const FRAME_DROP_THRESHOLD = 100000; // Drop frames more than 100ms behind (in microseconds)
const VIDEO_FILL_INTERVAL = 100; // Fill video buffer every 100ms - less aggressive
const AUDIO_FILL_INTERVAL = 100; // Fill audio buffer every 100ms - less aggressive
const AUDIO_SCHEDULE_INTERVAL = 50; // Schedule audio every 50ms - less aggressive

export function WebCodecsVideoPlayer({
  videoUrl,
  title,
  onClose,
}: WebCodecsVideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null); // Cache canvas context
  const [state, setState] = useState<PlayerState>({
    isPlaying: false,
    isLoading: true,
    error: null,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    buffering: false,
  });
  const [debugState, setDebugState] = useState<DebugState>({
    videoDecoderState: "unconfigured",
    audioDecoderState: "unconfigured",
    frameBufferSize: 0,
    audioBufferSize: 0,
    chunksDecoded: 0,
    framesRendered: 0,
    droppedFrames: 0,
    lastError: null,
    demuxerReady: false,
    videoSamplesReceived: 0,
    audioSamplesReceived: 0,
    videoTrackId: null,
    audioTrackId: null,
    videoIsEOF: false,
    audioIsEOF: false,
  });
  const [showDebug, setShowDebug] = useState(true);
  
  // Performance tracking refs (avoid state updates)
  const chunksDecodedRef = useRef(0);
  const framesRenderedRef = useRef(0);
  const droppedFramesRef = useRef(0);
  const lastDebugUpdateRef = useRef(0);
  const lastRenderedTimestampRef = useRef<number>(-1); // Track last rendered frame to avoid re-rendering same frame

  const videoDemuxerRef = useRef<MP4Demuxer | null>(null);
  const audioDemuxerRef = useRef<MP4Demuxer | null>(null);
  const videoDecoderRef = useRef<VideoDecoder | null>(null);
  const audioDecoderRef = useRef<AudioDecoder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const frameBufferRef = useRef<VideoFrame[]>([]);
  const audioBufferQueueRef = useRef<AudioData[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const playbackStartTimeRef = useRef<number>(0);
  const mediaStartTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const fillInProgressRef = useRef<boolean>(false);
  const audioFillInProgressRef = useRef<boolean>(false);
  const nextAudioTimeRef = useRef<number>(0);
  const isCleanedUpRef = useRef<boolean>(false);
  const needsKeyframeRef = useRef<boolean>(true); // After configure() or flush(), we need a keyframe
  
  // Separate intervals for buffer filling (don't tie to render loop)
  const videoFillIntervalRef = useRef<number | null>(null);
  const audioFillIntervalRef = useRef<number | null>(null);
  const audioScheduleIntervalRef = useRef<number | null>(null);
  
  // A/V sync: Use audioContext.currentTime as master clock
  // audioStartTimeRef = audioContext.currentTime when playback started
  // mediaTimeOffsetRef = media timestamp (in seconds) at audioStartTimeRef
  const audioStartTimeRef = useRef<number>(0);
  const mediaTimeOffsetRef = useRef<number>(0);

  const updateState = useCallback((updates: Partial<PlayerState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateDebugState = useCallback((updates: Partial<DebugState>) => {
    setDebugState((prev) => ({ ...prev, ...updates }));
  }, []);

  const initializePlayer = useCallback(async () => {
    try {
      isCleanedUpRef.current = false;
      updateState({ isLoading: true, error: null });

      if (!("VideoDecoder" in window)) {
        throw new Error(
          "WebCodecs API not supported. Tesla browser should support this feature."
        );
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("Canvas not available");
      }

      // Optimize canvas for video playback:
      // - alpha: false - no transparency needed, saves memory
      // - desynchronized: true - reduces latency by not syncing with compositor
      const ctx = canvas.getContext("2d", { 
        alpha: false, 
        desynchronized: true 
      });
      if (!ctx) {
        throw new Error("Failed to get canvas 2D context");
      }
      // Cache the context to avoid retrieving it every frame in renderLoop
      canvasCtxRef.current = ctx;

      videoDemuxerRef.current = new MP4Demuxer(videoUrl);
      await videoDemuxerRef.current.initialize(VIDEO_STREAM_TYPE);

      const videoConfig =
        videoDemuxerRef.current.getDecoderConfig() as VideoDecoderConfig;
      const videoInfo = videoDemuxerRef.current.getVideoInfo();

      if (!videoInfo) {
        throw new Error("Failed to get video info");
      }

      canvas.width = videoConfig.codedWidth;
      canvas.height = videoConfig.codedHeight;

      updateDebugState({ demuxerReady: true });

      videoDecoderRef.current = new VideoDecoder({
        output: (frame: VideoFrame) => {
          // Enforce hard limit to prevent memory issues and crashes
          if (frameBufferRef.current.length >= FRAME_BUFFER_MAX_SIZE) {
            // Drop oldest frame to make room
            const oldFrame = frameBufferRef.current.shift();
            if (oldFrame) {
              oldFrame.close();
              droppedFramesRef.current++;
            }
          }
          frameBufferRef.current.push(frame);
          // Don't update debug state here - too frequent, causes re-renders
        },
        error: (e: Error) => {
          console.error("VideoDecoder error:", e);
          updateState({ error: `Video decode error: ${e.message}` });
          updateDebugState({ lastError: `VideoDecoder: ${e.message}` });
        },
      });

      const videoSupport = await VideoDecoder.isConfigSupported({
        codec: videoConfig.codec,
        codedWidth: videoConfig.codedWidth,
        codedHeight: videoConfig.codedHeight,
        description: videoConfig.description,
      });

      if (!videoSupport.supported) {
        throw new Error(`Video codec not supported: ${videoConfig.codec}`);
      }

      videoDecoderRef.current.configure({
        codec: videoConfig.codec,
        codedWidth: videoConfig.codedWidth,
        codedHeight: videoConfig.codedHeight,
        description: videoConfig.description,
        hardwareAcceleration: "prefer-hardware", // Use GPU acceleration when available
      });
      updateDebugState({ videoDecoderState: "configured" });

      try {
        audioDemuxerRef.current = new MP4Demuxer(videoUrl);
        await audioDemuxerRef.current.initialize(AUDIO_STREAM_TYPE);

        const audioConfig =
          audioDemuxerRef.current.getDecoderConfig() as AudioDecoderConfig;
        const audioInfo = audioDemuxerRef.current.getAudioInfo();

        if (audioInfo) {
          audioContextRef.current = new AudioContext({
            sampleRate: audioConfig.sampleRate,
            latencyHint: "playback",
          });

          gainNodeRef.current = audioContextRef.current.createGain();
          gainNodeRef.current.connect(audioContextRef.current.destination);
          gainNodeRef.current.gain.value = state.volume;

          audioDecoderRef.current = new AudioDecoder({
            output: (audioData: AudioData) => {
              // Limit audio buffer to prevent memory issues (max 100 chunks)
              const MAX_AUDIO_BUFFER = 100;
              if (audioBufferQueueRef.current.length >= MAX_AUDIO_BUFFER) {
                const oldData = audioBufferQueueRef.current.shift();
                if (oldData) oldData.close();
              }
              audioBufferQueueRef.current.push(audioData);
              // Don't call scheduleAudioPlayback here - use interval instead
            },
            error: (e: Error) => {
              console.error("AudioDecoder error:", e);
            },
          });

          const audioSupport = await AudioDecoder.isConfigSupported({
            codec: audioConfig.codec,
            sampleRate: audioConfig.sampleRate,
            numberOfChannels: audioConfig.numberOfChannels,
            description: audioConfig.description,
          });

          if (audioSupport.supported) {
            audioDecoderRef.current.configure({
              codec: audioConfig.codec,
              sampleRate: audioConfig.sampleRate,
              numberOfChannels: audioConfig.numberOfChannels,
              description: audioConfig.description,
            });
            updateDebugState({ audioDecoderState: "configured" });
          } else {
            console.warn("Audio codec not supported, playing without audio");
            audioDecoderRef.current = null;
            updateDebugState({ audioDecoderState: "not supported" });
          }
        }
      } catch (audioError) {
        console.warn("Audio initialization failed, playing without audio:", audioError);
      }

      updateState({
        isLoading: false,
        duration: videoInfo.duration,
      });

      await fillFrameBuffer();
    } catch (err) {
      console.error("Player initialization error:", err);
      updateState({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to initialize player",
      });
    }
  }, [videoUrl, state.volume, updateState]);

  const scheduleAudioPlayback = useCallback(() => {
    if (
      !audioContextRef.current ||
      !gainNodeRef.current ||
      !isPlayingRef.current
    ) {
      return;
    }

    // Schedule audio buffers using their ACTUAL timestamps from the demuxer
    // This is critical for proper A/V sync - we must respect the original timestamps
    const currentAudioContextTime = audioContextRef.current.currentTime;
    
    // Process audio chunks one at a time to respect their timestamps
    while (audioBufferQueueRef.current.length > 0) {
      const audioData = audioBufferQueueRef.current[0];
      
      // Calculate when this audio chunk should play based on its timestamp
      // audioData.timestamp is in microseconds, convert to seconds
      const audioTimestampSeconds = audioData.timestamp / 1_000_000;
      
      // Calculate the playback time for this chunk:
      // playbackTime = audioContextTime when playback started + (chunk timestamp - media start time)
      const scheduledTime = audioStartTimeRef.current + (audioTimestampSeconds - mediaTimeOffsetRef.current);
      
      // Don't schedule audio that's too far in the future
      if (scheduledTime > currentAudioContextTime + AUDIO_SCHEDULE_AHEAD) {
        break;
      }
      
      // Remove from queue
      audioBufferQueueRef.current.shift();
      
      // Skip audio that's already in the past (we're behind)
      if (scheduledTime < currentAudioContextTime - 0.1) {
        audioData.close();
        continue;
      }

      const numberOfFrames = audioData.numberOfFrames;
      const numberOfChannels = audioData.numberOfChannels;
      const sampleRate = audioData.sampleRate;

      const audioBuffer = audioContextRef.current.createBuffer(
        numberOfChannels,
        numberOfFrames,
        sampleRate
      );

      for (let channel = 0; channel < numberOfChannels; channel++) {
        const channelData = new Float32Array(numberOfFrames);
        audioData.copyTo(channelData, {
          planeIndex: channel,
          format: "f32-planar",
        });
        audioBuffer.copyToChannel(channelData, channel);
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNodeRef.current);

      // Schedule at the correct time based on the chunk's timestamp
      const startTime = Math.max(scheduledTime, currentAudioContextTime);
      source.start(startTime);

      audioData.close();
    }
  }, []);

  const fillFrameBuffer = useCallback(async () => {
    if (fillInProgressRef.current) return;
    if (isCleanedUpRef.current) return;
    if (frameBufferRef.current.length >= FRAME_BUFFER_TARGET_SIZE) return;
    if (!videoDemuxerRef.current || !videoDecoderRef.current) return;
    if (videoDecoderRef.current.state === "closed") {
      updateDebugState({ videoDecoderState: "closed" });
      return;
    }

    fillInProgressRef.current = true;

    try {
      while (
        frameBufferRef.current.length < FRAME_BUFFER_TARGET_SIZE &&
        videoDecoderRef.current &&
        videoDecoderRef.current.state !== "closed" &&
        videoDecoderRef.current.decodeQueueSize < FRAME_BUFFER_TARGET_SIZE * 2
      ) {
        const chunk = await videoDemuxerRef.current.getNextChunk();
        if (!chunk) break;
        if (isCleanedUpRef.current || videoDecoderRef.current.state === "closed") break;

        const videoChunk = chunk as EncodedVideoChunk;
        
        // After configure() or flush(), we need to start with a keyframe
        if (needsKeyframeRef.current) {
          if (videoChunk.type !== "key") {
            // Skip delta frames until we get a keyframe
            continue;
          }
          needsKeyframeRef.current = false;
        }

        videoDecoderRef.current.decode(videoChunk);
        chunksDecodedRef.current++;
      }

      updateDebugState({ chunksDecoded: chunksDecodedRef.current });
      
      // Don't call flush() during normal playback - it causes the keyframe requirement issue
      // flush() should only be called when seeking or stopping
    } catch (err) {
      console.error("Error filling frame buffer:", err);
      updateDebugState({ lastError: `fillFrameBuffer: ${err instanceof Error ? err.message : String(err)}` });
    }

    fillInProgressRef.current = false;
    // Removed setTimeout recursion - now using separate intervals via startBufferIntervals()
  }, [updateDebugState]);

  const fillAudioBuffer = useCallback(async () => {
    if (audioFillInProgressRef.current) return;
    if (isCleanedUpRef.current) return;
    if (!audioDemuxerRef.current || !audioDecoderRef.current) return;
    if (audioDecoderRef.current.state === "closed") return;

    audioFillInProgressRef.current = true;

    try {
      // Increased batch size and queue limit for smoother audio
      // Decode more chunks at once to keep buffer full
      const targetChunks = 50;
      let decodedChunks = 0;

      while (
        decodedChunks < targetChunks &&
        audioDecoderRef.current &&
        audioDecoderRef.current.state !== "closed" &&
        audioDecoderRef.current.decodeQueueSize < 30
      ) {
        const chunk = await audioDemuxerRef.current.getNextChunk();
        if (!chunk) break;
        if (isCleanedUpRef.current || audioDecoderRef.current.state === "closed") break;

        audioDecoderRef.current.decode(chunk as EncodedAudioChunk);
        decodedChunks++;
      }

      // Don't call flush() during normal playback - it blocks and causes audio gaps
      // Let the decoder output frames asynchronously via the output callback
    } catch (err) {
      console.error("Error filling audio buffer:", err);
    }

    audioFillInProgressRef.current = false;
    // Removed setTimeout recursion - now using separate intervals via startBufferIntervals()
  }, []);

  const chooseFrame = useCallback((targetTimestamp: number): VideoFrame | null => {
    const buffer = frameBufferRef.current;
    if (buffer.length === 0) return null;

    // Binary search for the frame closest to targetTimestamp
    // Frames are sorted by timestamp in ascending order
    let left = 0;
    let right = buffer.length - 1;
    let bestIndex = 0;
    let bestDelta = Math.abs(targetTimestamp - buffer[0].timestamp);

    while (left <= right) {
      const mid = (left + right) >>> 1; // Faster than Math.floor
      const delta = Math.abs(targetTimestamp - buffer[mid].timestamp);
      
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = mid;
      }
      
      if (buffer[mid].timestamp < targetTimestamp) {
        left = mid + 1;
      } else if (buffer[mid].timestamp > targetTimestamp) {
        right = mid - 1;
      } else {
        // Exact match
        bestIndex = mid;
        break;
      }
    }

    // Close and remove all frames before the best frame
    // Use splice() once instead of multiple shift() calls for better performance
    if (bestIndex > 0) {
      const staleFrames = buffer.splice(0, bestIndex);
      for (const frame of staleFrames) {
        frame.close();
      }
    }

    return buffer[0] || null;
  }, []);

  const renderLoop = useCallback(() => {
    if (!isPlayingRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvasCtxRef.current; // Use cached context instead of retrieving every frame
    if (!canvas || !ctx) return;

    // Get current time once at the start of the frame for consistency
    const now = performance.now();

    // Use AudioContext as master clock for A/V sync
    // If no audio context, fall back to performance.now()
    let currentMediaTime: number;
    if (audioContextRef.current) {
      const audioElapsed = audioContextRef.current.currentTime - audioStartTimeRef.current;
      currentMediaTime = (mediaTimeOffsetRef.current + audioElapsed) * 1_000_000; // Convert to microseconds
    } else {
      const elapsedTime = now - playbackStartTimeRef.current;
      currentMediaTime = mediaStartTimeRef.current + elapsedTime * 1000;
    }

    // Drop frames that are too far behind (more than FRAME_DROP_THRESHOLD microseconds)
    // Find how many frames to drop, then use splice() once for better performance
    let dropCount = 0;
    const buffer = frameBufferRef.current;
    while (dropCount < buffer.length - 1) {
      if (currentMediaTime - buffer[dropCount].timestamp > FRAME_DROP_THRESHOLD) {
        dropCount++;
      } else {
        break;
      }
    }
    if (dropCount > 0) {
      const droppedFrames = buffer.splice(0, dropCount);
      for (const frame of droppedFrames) {
        frame.close();
      }
      droppedFramesRef.current += dropCount;
    }

    const frame = chooseFrame(currentMediaTime);

    if (frame) {
      // Frame rate limiting: Only render if this is a new frame
      // This saves CPU when display refresh rate > video frame rate (e.g., 60Hz display, 24fps video)
      if (frame.timestamp !== lastRenderedTimestampRef.current) {
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        framesRenderedRef.current++;
        lastRenderedTimestampRef.current = frame.timestamp;
      }

      const currentTimeSeconds = frame.timestamp / 1_000_000;
      
      // Throttle state updates - only update currentTime every 100ms
      if (now - lastDebugUpdateRef.current > 100) {
        updateState({ currentTime: currentTimeSeconds, buffering: false });
      }
    } else {
      // Only update buffering state occasionally to avoid re-renders
      if (now - lastDebugUpdateRef.current > 100) {
        updateState({ buffering: true });
      }
    }

    // Throttle debug panel updates to every DEBUG_UPDATE_INTERVAL ms
    if (now - lastDebugUpdateRef.current > DEBUG_UPDATE_INTERVAL) {
      lastDebugUpdateRef.current = now;
      const videoDebug = videoDemuxerRef.current?.getDebugInfo();
      const audioDebug = audioDemuxerRef.current?.getDebugInfo();
      updateDebugState({
        framesRendered: framesRenderedRef.current,
        chunksDecoded: chunksDecodedRef.current,
        droppedFrames: droppedFramesRef.current,
        frameBufferSize: frameBufferRef.current.length,
        videoSamplesReceived: videoDebug?.samplesReceived ?? 0,
        audioSamplesReceived: audioDebug?.samplesReceived ?? 0,
        videoTrackId: videoDebug?.trackId ?? null,
        audioTrackId: audioDebug?.trackId ?? null,
        videoIsEOF: videoDebug?.isEOF ?? false,
        audioIsEOF: audioDebug?.isEOF ?? false,
      });
    }

    // Don't call fillFrameBuffer/fillAudioBuffer here - use separate intervals
    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [chooseFrame, updateState, updateDebugState]);

  // Start separate intervals for buffer filling (decoupled from render loop)
  const startBufferIntervals = useCallback(() => {
    // Video buffer filling - more aggressive for smoother playback
    if (!videoFillIntervalRef.current) {
      videoFillIntervalRef.current = window.setInterval(() => {
        if (isPlayingRef.current && !isCleanedUpRef.current) {
          fillFrameBuffer();
        }
      }, VIDEO_FILL_INTERVAL);
    }
    
    // Audio buffer filling - more aggressive for smoother audio
    if (!audioFillIntervalRef.current) {
      audioFillIntervalRef.current = window.setInterval(() => {
        if (isPlayingRef.current && !isCleanedUpRef.current) {
          fillAudioBuffer();
        }
      }, AUDIO_FILL_INTERVAL);
    }
    
    // Audio scheduling - more aggressive to prevent gaps
    if (!audioScheduleIntervalRef.current) {
      audioScheduleIntervalRef.current = window.setInterval(() => {
        if (isPlayingRef.current && !isCleanedUpRef.current) {
          scheduleAudioPlayback();
        }
      }, AUDIO_SCHEDULE_INTERVAL);
    }
  }, [fillFrameBuffer, fillAudioBuffer, scheduleAudioPlayback]);

  // Stop all buffer filling intervals
  const stopBufferIntervals = useCallback(() => {
    if (videoFillIntervalRef.current) {
      clearInterval(videoFillIntervalRef.current);
      videoFillIntervalRef.current = null;
    }
    if (audioFillIntervalRef.current) {
      clearInterval(audioFillIntervalRef.current);
      audioFillIntervalRef.current = null;
    }
    if (audioScheduleIntervalRef.current) {
      clearInterval(audioScheduleIntervalRef.current);
      audioScheduleIntervalRef.current = null;
    }
  }, []);

  const play = useCallback(async () => {
    if (isPlayingRef.current) return;

    isPlayingRef.current = true;
    updateState({ isPlaying: true });

    if (audioContextRef.current?.state === "suspended") {
      await audioContextRef.current.resume();
    }

    // Initialize A/V sync timing
    // audioStartTimeRef = current audioContext time when playback starts
    // mediaTimeOffsetRef = media timestamp (in seconds) that corresponds to audioStartTimeRef
    if (audioContextRef.current) {
      audioStartTimeRef.current = audioContextRef.current.currentTime;
      // mediaStartTimeRef is in microseconds, convert to seconds for mediaTimeOffsetRef
      // This represents the media position we're starting from
      mediaTimeOffsetRef.current = mediaStartTimeRef.current / 1_000_000;
      
      // If we have frames in the buffer, use the first frame's timestamp as the starting point
      // This ensures proper sync when the media doesn't start at timestamp 0
      if (frameBufferRef.current.length > 0) {
        const firstFrameTimestamp = frameBufferRef.current[0].timestamp / 1_000_000;
        // Only use first frame timestamp if we're starting from the beginning
        if (mediaTimeOffsetRef.current === 0 || mediaTimeOffsetRef.current < firstFrameTimestamp) {
          mediaTimeOffsetRef.current = firstFrameTimestamp;
          mediaStartTimeRef.current = firstFrameTimestamp * 1_000_000;
        }
      }
    }
    
    playbackStartTimeRef.current = performance.now();

    // Initial buffer fill before starting playback
    await fillFrameBuffer();
    await fillAudioBuffer();
    
    // After filling buffers, update mediaTimeOffsetRef if we now have frames
    if (audioContextRef.current && frameBufferRef.current.length > 0 && mediaTimeOffsetRef.current === 0) {
      const firstFrameTimestamp = frameBufferRef.current[0].timestamp / 1_000_000;
      mediaTimeOffsetRef.current = firstFrameTimestamp;
      mediaStartTimeRef.current = firstFrameTimestamp * 1_000_000;
    }
    
    scheduleAudioPlayback();

    // Start separate intervals for continuous buffer filling
    startBufferIntervals();

    renderLoop();
  }, [renderLoop, fillFrameBuffer, fillAudioBuffer, scheduleAudioPlayback, startBufferIntervals, updateState]);

  const pause = useCallback(() => {
    isPlayingRef.current = false;
    updateState({ isPlaying: false });

    // Stop buffer filling intervals
    stopBufferIntervals();

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Save current media position based on audio context time (for A/V sync)
    if (audioContextRef.current) {
      const audioElapsed = audioContextRef.current.currentTime - audioStartTimeRef.current;
      mediaStartTimeRef.current = (mediaTimeOffsetRef.current + audioElapsed) * 1_000_000;
    } else {
      mediaStartTimeRef.current +=
        (performance.now() - playbackStartTimeRef.current) * 1000;
    }

    if (audioContextRef.current?.state === "running") {
      audioContextRef.current.suspend();
    }
  }, [stopBufferIntervals, updateState]);

  const togglePlayPause = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [state.isPlaying, play, pause]);

  const handleSeek = useCallback(
    (value: number[]) => {
      const newTime = value[0];
      const wasPlaying = isPlayingRef.current;

      if (wasPlaying) {
        pause();
      }

      for (const frame of frameBufferRef.current) {
        frame.close();
      }
      frameBufferRef.current = [];

      for (const audioData of audioBufferQueueRef.current) {
        audioData.close();
      }
      audioBufferQueueRef.current = [];

      mediaStartTimeRef.current = newTime * 1_000_000;
      updateState({ currentTime: newTime });

      // After seeking, we need to start with a keyframe
      needsKeyframeRef.current = true;

      videoDemuxerRef.current?.seek(newTime);
      audioDemuxerRef.current?.seek(newTime);

      fillFrameBuffer().then(() => {
        if (wasPlaying) {
          play();
        }
      });
    },
    [pause, play, fillFrameBuffer, updateState]
  );

  const handleVolumeChange = useCallback(
    (value: number[]) => {
      const newVolume = value[0];
      updateState({ volume: newVolume });

      if (gainNodeRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(
          newVolume,
          audioContextRef.current?.currentTime || 0,
          0.1
        );
      }

      if (newVolume > 0 && state.isMuted) {
        updateState({ isMuted: false });
      }
    },
    [state.isMuted, updateState]
  );

  const toggleMute = useCallback(() => {
    const newMuted = !state.isMuted;
    updateState({ isMuted: newMuted });

    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(
        newMuted ? 0 : state.volume,
        audioContextRef.current?.currentTime || 0,
        0.1
      );
    }
  }, [state.isMuted, state.volume, updateState]);

  const toggleFullscreen = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!document.fullscreenElement) {
      canvas.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  }, []);

  const skipForward = useCallback(() => {
    const newTime = Math.min(state.currentTime + 10, state.duration);
    handleSeek([newTime]);
  }, [state.currentTime, state.duration, handleSeek]);

  const skipBackward = useCallback(() => {
    const newTime = Math.max(state.currentTime - 10, 0);
    handleSeek([newTime]);
  }, [state.currentTime, handleSeek]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    initializePlayer();

    return () => {
      if (isCleanedUpRef.current) return;
      isCleanedUpRef.current = true;
      isPlayingRef.current = false;

      // Clear buffer filling intervals
      if (videoFillIntervalRef.current) {
        clearInterval(videoFillIntervalRef.current);
        videoFillIntervalRef.current = null;
      }
      if (audioFillIntervalRef.current) {
        clearInterval(audioFillIntervalRef.current);
        audioFillIntervalRef.current = null;
      }
      if (audioScheduleIntervalRef.current) {
        clearInterval(audioScheduleIntervalRef.current);
        audioScheduleIntervalRef.current = null;
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      for (const frame of frameBufferRef.current) {
        try {
          frame.close();
        } catch (e) {
          // Frame may already be closed
        }
      }
      frameBufferRef.current = [];

      for (const audioData of audioBufferQueueRef.current) {
        try {
          audioData.close();
        } catch (e) {
          // AudioData may already be closed
        }
      }
      audioBufferQueueRef.current = [];

      if (videoDecoderRef.current && videoDecoderRef.current.state !== "closed") {
        try {
          videoDecoderRef.current.close();
        } catch (e) {
          console.warn("Error closing video decoder:", e);
        }
      }
      videoDecoderRef.current = null;

      if (audioDecoderRef.current && audioDecoderRef.current.state !== "closed") {
        try {
          audioDecoderRef.current.close();
        } catch (e) {
          console.warn("Error closing audio decoder:", e);
        }
      }
      audioDecoderRef.current = null;

      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        try {
          audioContextRef.current.close();
        } catch (e) {
          console.warn("Error closing audio context:", e);
        }
      }
      audioContextRef.current = null;

      videoDemuxerRef.current?.stop();
      audioDemuxerRef.current?.stop();
      videoDemuxerRef.current = null;
      audioDemuxerRef.current = null;
    };
  }, [initializePlayer]);

  if (state.error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-8">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">Playback Error</h2>
          <p className="text-gray-400 mb-6">{state.error}</p>
          <Button onClick={onClose} variant="outline">
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black flex flex-col">
      <div className="flex-1 flex items-center justify-center relative">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          style={{ touchAction: "none" }}
        />

        {state.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin text-white mx-auto mb-4" />
              <p className="text-white">Initializing WebCodecs player...</p>
            </div>
          </div>
        )}

        {state.buffering && !state.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-12 h-12 animate-spin text-white" />
          </div>
        )}

        {!state.isPlaying && !state.isLoading && (
          <button
            onClick={togglePlayPause}
            className="absolute inset-0 flex items-center justify-center group"
          >
            <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 transition-colors">
              <Play className="w-10 h-10 text-white ml-1" />
            </div>
          </button>
        )}

        {showDebug && (
          <div className="absolute top-2 left-2 bg-black/80 text-white text-xs p-3 rounded-lg font-mono max-w-sm">
            <div className="font-bold mb-2 text-yellow-400">Debug Panel</div>
            <div className="space-y-1">
              <div>Video Decoder: <span className={debugState.videoDecoderState === "configured" ? "text-green-400" : "text-red-400"}>{debugState.videoDecoderState}</span></div>
              <div>Audio Decoder: <span className={debugState.audioDecoderState === "configured" ? "text-green-400" : "text-red-400"}>{debugState.audioDecoderState}</span></div>
              <div>Demuxer Ready: <span className={debugState.demuxerReady ? "text-green-400" : "text-red-400"}>{debugState.demuxerReady ? "Yes" : "No"}</span></div>
              <div className="border-t border-gray-600 my-1 pt-1 font-bold text-cyan-400">Video Demuxer:</div>
              <div>Track ID: <span className="text-blue-400">{debugState.videoTrackId ?? "null"}</span></div>
              <div>Samples Received: <span className={debugState.videoSamplesReceived > 0 ? "text-green-400" : "text-red-400"}>{debugState.videoSamplesReceived}</span></div>
              <div>EOF: <span className={debugState.videoIsEOF ? "text-yellow-400" : "text-gray-400"}>{debugState.videoIsEOF ? "Yes" : "No"}</span></div>
              <div className="border-t border-gray-600 my-1 pt-1 font-bold text-cyan-400">Audio Demuxer:</div>
              <div>Track ID: <span className="text-blue-400">{debugState.audioTrackId ?? "null"}</span></div>
              <div>Samples Received: <span className={debugState.audioSamplesReceived > 0 ? "text-green-400" : "text-red-400"}>{debugState.audioSamplesReceived}</span></div>
              <div>EOF: <span className={debugState.audioIsEOF ? "text-yellow-400" : "text-gray-400"}>{debugState.audioIsEOF ? "Yes" : "No"}</span></div>
              <div className="border-t border-gray-600 my-1 pt-1 font-bold text-cyan-400">Playback:</div>
              <div>Frame Buffer: <span className={debugState.frameBufferSize > 0 ? "text-green-400" : "text-yellow-400"}>{debugState.frameBufferSize}</span></div>
              <div>Chunks Decoded: <span className="text-blue-400">{debugState.chunksDecoded}</span></div>
              <div>Frames Rendered: <span className="text-blue-400">{debugState.framesRendered}</span></div>
              <div>Dropped Frames: <span className={debugState.droppedFrames > 0 ? "text-red-400" : "text-green-400"}>{debugState.droppedFrames}</span></div>
              <div>Buffering: <span className={state.buffering ? "text-yellow-400" : "text-green-400"}>{state.buffering ? "Yes" : "No"}</span></div>
              <div>Playing: <span className={state.isPlaying ? "text-green-400" : "text-gray-400"}>{state.isPlaying ? "Yes" : "No"}</span></div>
              {debugState.lastError && (
                <div className="text-red-400 mt-2 break-words">Error: {debugState.lastError}</div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => setShowDebug(!showDebug)}
          className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded hover:bg-black/80"
        >
          {showDebug ? "Hide Debug" : "Show Debug"}
        </button>
      </div>

      <div className="bg-gradient-to-t from-black via-black/90 to-transparent p-6 space-y-4">
        {title && (
          <h3 className="text-white font-semibold text-lg truncate">{title}</h3>
        )}

        <div className="space-y-2">
          <Slider
            value={[state.currentTime]}
            max={state.duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-sm text-gray-400">
            <span>{formatTime(state.currentTime)}</span>
            <span>{formatTime(state.duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              onClick={skipBackward}
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10"
            >
              <SkipBack className="w-5 h-5" />
            </Button>

            <Button
              onClick={togglePlayPause}
              size="lg"
              variant="ghost"
              className="text-white hover:bg-white/10"
            >
              {state.isPlaying ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6" />
              )}
            </Button>

            <Button
              onClick={skipForward}
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10"
            >
              <SkipForward className="w-5 h-5" />
            </Button>

            <div className="flex items-center gap-2">
              <Button
                onClick={toggleMute}
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10"
              >
                {state.isMuted || state.volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </Button>
              <Slider
                value={[state.isMuted ? 0 : state.volume]}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
                className="w-24 cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onClose && (
              <Button
                onClick={onClose}
                variant="ghost"
                className="text-white hover:bg-white/10"
              >
                Back
              </Button>
            )}

            <Button
              onClick={toggleFullscreen}
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10"
            >
              <Maximize className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
