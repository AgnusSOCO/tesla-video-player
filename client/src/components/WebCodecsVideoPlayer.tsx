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
  droppedFrames: number;
  lastError: string | null;
  demuxerReady: boolean;
  videoSamplesReceived: number;
  audioSamplesReceived: number;
  videoTrackId: number | null;
  audioTrackId: number | null;
  videoIsEOF: boolean;
  audioIsEOF: boolean;
}

// SIMPLIFIED APPROACH: Focus on reliability over complex optimizations
// Key principles:
// 1. Stream audio in chunks with scheduled playback (not pre-decode everything)
// 2. Simple video rendering at consistent frame rate
// 3. Audio is master clock for A/V sync

// Video buffer settings
const FRAME_BUFFER_TARGET = 30; // 1 second at 30fps
const FRAME_BUFFER_MAX = 60; // 2 seconds max
const VIDEO_DECODE_BATCH = 5; // Decode 5 chunks at a time

// Audio buffer settings - STREAMING APPROACH
const AUDIO_BUFFER_COUNT = 20; // Keep 20 audio buffers ready
const AUDIO_SCHEDULE_AHEAD = 0.5; // Schedule audio 0.5 seconds ahead

// Timing
const RENDER_INTERVAL = 33; // ~30fps
const BUFFER_FILL_INTERVAL = 100; // Fill buffers every 100ms
const DEBUG_UPDATE_INTERVAL = 500;

export function WebCodecsVideoPlayer({
  videoUrl,
  title,
  onClose,
}: WebCodecsVideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  
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

  // Refs for demuxers and decoders
  const videoDemuxerRef = useRef<MP4Demuxer | null>(null);
  const audioDemuxerRef = useRef<MP4Demuxer | null>(null);
  const videoDecoderRef = useRef<VideoDecoder | null>(null);
  const audioDecoderRef = useRef<AudioDecoder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Video frame buffer
  const frameBufferRef = useRef<VideoFrame[]>([]);
  
  // Audio buffer queue - stores decoded AudioBuffers for scheduling
  const audioBufferQueueRef = useRef<AudioBuffer[]>([]);
  const nextAudioTimeRef = useRef<number>(0); // Next AudioContext time to schedule audio
  
  // Playback state
  const isPlayingRef = useRef<boolean>(false);
  const isCleanedUpRef = useRef<boolean>(false);
  const needsKeyframeRef = useRef<boolean>(true);
  
  // Timing refs
  const playbackStartTimeRef = useRef<number>(0); // AudioContext time when playback started
  const mediaStartTimeRef = useRef<number>(0); // Media time (microseconds) when playback started
  
  // Intervals
  const renderIntervalRef = useRef<number | null>(null);
  const bufferFillIntervalRef = useRef<number | null>(null);
  const audioScheduleIntervalRef = useRef<number | null>(null);
  
  // Stats
  const chunksDecodedRef = useRef(0);
  const framesRenderedRef = useRef(0);
  const droppedFramesRef = useRef(0);
  const lastDebugUpdateRef = useRef(0);
  
  // Audio config
  const audioSampleRateRef = useRef<number>(44100);
  const audioChannelsRef = useRef<number>(2);

  const updateState = useCallback((updates: Partial<PlayerState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateDebugState = useCallback((updates: Partial<DebugState>) => {
    setDebugState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Convert AudioData to AudioBuffer for Web Audio API
  const audioDataToBuffer = useCallback((audioData: AudioData): AudioBuffer | null => {
    if (!audioContextRef.current) return null;
    
    const numberOfFrames = audioData.numberOfFrames;
    const numberOfChannels = audioData.numberOfChannels;
    const sampleRate = audioData.sampleRate;
    
    try {
      const buffer = audioContextRef.current.createBuffer(
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
        buffer.copyToChannel(channelData, channel);
      }
      
      return buffer;
    } catch (e) {
      console.error("Error converting AudioData to AudioBuffer:", e);
      return null;
    }
  }, []);

  // Schedule audio buffers for playback
  const scheduleAudioBuffers = useCallback(() => {
    if (!audioContextRef.current || !gainNodeRef.current || !isPlayingRef.current) return;
    
    const ctx = audioContextRef.current;
    const currentTime = ctx.currentTime;
    
    // Calculate how far ahead we need to schedule
    const scheduleUntil = currentTime + AUDIO_SCHEDULE_AHEAD;
    
    // Schedule pending audio buffers
    while (audioBufferQueueRef.current.length > 0 && nextAudioTimeRef.current < scheduleUntil) {
      const buffer = audioBufferQueueRef.current.shift();
      if (!buffer) break;
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNodeRef.current);
      
      // Schedule at the next audio time
      const startTime = Math.max(nextAudioTimeRef.current, currentTime);
      source.start(startTime);
      
      // Update next audio time
      nextAudioTimeRef.current = startTime + buffer.duration;
    }
  }, []);

  // Fill video frame buffer
  const fillVideoBuffer = useCallback(async () => {
    if (isCleanedUpRef.current) return;
    if (!videoDemuxerRef.current || !videoDecoderRef.current) return;
    if (videoDecoderRef.current.state === "closed") return;
    if (frameBufferRef.current.length >= FRAME_BUFFER_TARGET) return;

    try {
      let decoded = 0;
      while (
        decoded < VIDEO_DECODE_BATCH &&
        frameBufferRef.current.length < FRAME_BUFFER_MAX &&
        videoDecoderRef.current &&
        videoDecoderRef.current.state !== "closed"
      ) {
        const chunk = await videoDemuxerRef.current.getNextChunk();
        if (!chunk) break;
        if (isCleanedUpRef.current) break;

        const videoChunk = chunk as EncodedVideoChunk;
        
        // Skip until we get a keyframe after configure/flush
        if (needsKeyframeRef.current) {
          if (videoChunk.type !== "key") continue;
          needsKeyframeRef.current = false;
        }

        videoDecoderRef.current.decode(videoChunk);
        chunksDecodedRef.current++;
        decoded++;
      }
    } catch (err) {
      console.error("Error filling video buffer:", err);
      updateDebugState({ lastError: `fillVideoBuffer: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [updateDebugState]);

  // Fill audio buffer
  const fillAudioBuffer = useCallback(async () => {
    if (isCleanedUpRef.current) return;
    if (!audioDemuxerRef.current || !audioDecoderRef.current) return;
    if (audioDecoderRef.current.state === "closed") return;
    if (audioBufferQueueRef.current.length >= AUDIO_BUFFER_COUNT) return;

    try {
      // Decode a batch of audio chunks
      let decoded = 0;
      while (decoded < 10 && audioDecoderRef.current && audioDecoderRef.current.state !== "closed") {
        // Wait if decoder queue is too full
        if (audioDecoderRef.current.decodeQueueSize > 20) {
          await new Promise(resolve => setTimeout(resolve, 10));
          continue;
        }
        
        const chunk = await audioDemuxerRef.current.getNextChunk();
        if (!chunk) break;
        if (isCleanedUpRef.current) break;

        audioDecoderRef.current.decode(chunk as EncodedAudioChunk);
        decoded++;
      }
    } catch (err) {
      console.error("Error filling audio buffer:", err);
    }
  }, []);

  // Get current media time based on audio context
  const getCurrentMediaTime = useCallback((): number => {
    if (!audioContextRef.current || !isPlayingRef.current) {
      return mediaStartTimeRef.current;
    }
    
    const audioElapsed = audioContextRef.current.currentTime - playbackStartTimeRef.current;
    return mediaStartTimeRef.current + audioElapsed * 1_000_000; // Convert to microseconds
  }, []);

  // Render video frame
  const renderFrame = useCallback(() => {
    if (!isPlayingRef.current || isCleanedUpRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvasCtxRef.current;
    if (!canvas || !ctx) return;
    
    const buffer = frameBufferRef.current;
    if (buffer.length === 0) {
      updateState({ buffering: true });
      return;
    }
    
    const currentMediaTime = getCurrentMediaTime();
    
    // Find the best frame to display (closest to current time, but not in the future)
    let bestFrameIndex = -1;
    let bestFrameTime = -Infinity;
    
    for (let i = 0; i < buffer.length; i++) {
      const frameTime = buffer[i].timestamp;
      if (frameTime <= currentMediaTime && frameTime > bestFrameTime) {
        bestFrameIndex = i;
        bestFrameTime = frameTime;
      }
    }
    
    // If no frame is ready yet, wait
    if (bestFrameIndex === -1) {
      // Check if we're too far behind - use first frame
      if (buffer.length > 0 && buffer[0].timestamp > currentMediaTime + 100000) {
        // We're more than 100ms ahead of the first frame - just wait
        return;
      }
      return;
    }
    
    // Remove and close all frames before the best frame
    const framesToRemove = buffer.splice(0, bestFrameIndex);
    for (const frame of framesToRemove) {
      frame.close();
      droppedFramesRef.current++;
    }
    
    // Display the best frame
    const frameToDisplay = buffer.shift();
    if (frameToDisplay) {
      ctx.drawImage(frameToDisplay, 0, 0, canvas.width, canvas.height);
      framesRenderedRef.current++;
      frameToDisplay.close();
      
      updateState({ 
        currentTime: bestFrameTime / 1_000_000,
        buffering: false 
      });
    }
    
    // Update debug state periodically
    const now = performance.now();
    if (now - lastDebugUpdateRef.current > DEBUG_UPDATE_INTERVAL) {
      lastDebugUpdateRef.current = now;
      const videoDebug = videoDemuxerRef.current?.getDebugInfo();
      const audioDebug = audioDemuxerRef.current?.getDebugInfo();
      updateDebugState({
        frameBufferSize: frameBufferRef.current.length,
        audioBufferSize: audioBufferQueueRef.current.length,
        chunksDecoded: chunksDecodedRef.current,
        framesRendered: framesRenderedRef.current,
        droppedFrames: droppedFramesRef.current,
        videoSamplesReceived: videoDebug?.samplesReceived ?? 0,
        audioSamplesReceived: audioDebug?.samplesReceived ?? 0,
        videoIsEOF: videoDebug?.isEOF ?? false,
        audioIsEOF: audioDebug?.isEOF ?? false,
      });
    }
  }, [getCurrentMediaTime, updateState, updateDebugState]);

  // Initialize player
  const initializePlayer = useCallback(async () => {
    try {
      isCleanedUpRef.current = false;
      updateState({ isLoading: true, error: null });

      if (!("VideoDecoder" in window)) {
        throw new Error("WebCodecs API not supported. Tesla browser should support this feature.");
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("Canvas not available");
      }

      const ctx = canvas.getContext("2d", { 
        alpha: false, 
        desynchronized: true,
      });
      if (!ctx) {
        throw new Error("Failed to get canvas 2D context");
      }
      canvasCtxRef.current = ctx;

      // Initialize video demuxer and decoder
      videoDemuxerRef.current = new MP4Demuxer(videoUrl);
      await videoDemuxerRef.current.initialize(VIDEO_STREAM_TYPE);

      const videoConfig = videoDemuxerRef.current.getDecoderConfig() as VideoDecoderConfig;
      const videoInfo = videoDemuxerRef.current.getVideoInfo();

      if (!videoInfo) {
        throw new Error("Failed to get video info");
      }

      canvas.width = videoConfig.codedWidth;
      canvas.height = videoConfig.codedHeight;

      updateDebugState({ demuxerReady: true });

      videoDecoderRef.current = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (frameBufferRef.current.length >= FRAME_BUFFER_MAX) {
            const oldFrame = frameBufferRef.current.shift();
            if (oldFrame) {
              oldFrame.close();
              droppedFramesRef.current++;
            }
          }
          frameBufferRef.current.push(frame);
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
        hardwareAcceleration: "prefer-hardware",
      });
      updateDebugState({ videoDecoderState: "configured" });

      // Initialize audio demuxer and decoder
      try {
        audioDemuxerRef.current = new MP4Demuxer(videoUrl);
        await audioDemuxerRef.current.initialize(AUDIO_STREAM_TYPE);

        const audioConfig = audioDemuxerRef.current.getDecoderConfig() as AudioDecoderConfig;
        const audioInfo = audioDemuxerRef.current.getAudioInfo();

        if (audioInfo) {
          audioSampleRateRef.current = audioConfig.sampleRate;
          audioChannelsRef.current = audioConfig.numberOfChannels;
          
          audioContextRef.current = new AudioContext({
            sampleRate: audioConfig.sampleRate,
            latencyHint: "playback",
          });

          gainNodeRef.current = audioContextRef.current.createGain();
          gainNodeRef.current.connect(audioContextRef.current.destination);
          gainNodeRef.current.gain.value = state.volume;

          audioDecoderRef.current = new AudioDecoder({
            output: (audioData: AudioData) => {
              // Convert AudioData to AudioBuffer and add to queue
              const buffer = audioDataToBuffer(audioData);
              if (buffer) {
                audioBufferQueueRef.current.push(buffer);
              }
              audioData.close();
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

      // Pre-fill buffers
      await fillVideoBuffer();
      await fillAudioBuffer();
    } catch (err) {
      console.error("Player initialization error:", err);
      updateState({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to initialize player",
      });
    }
  }, [videoUrl, state.volume, updateState, updateDebugState, fillVideoBuffer, fillAudioBuffer, audioDataToBuffer]);

  // Start playback intervals
  const startPlaybackIntervals = useCallback(() => {
    // Video rendering at fixed interval
    if (!renderIntervalRef.current) {
      renderIntervalRef.current = window.setInterval(() => {
        if (isPlayingRef.current) {
          renderFrame();
        }
      }, RENDER_INTERVAL);
    }
    
    // Buffer filling
    if (!bufferFillIntervalRef.current) {
      bufferFillIntervalRef.current = window.setInterval(() => {
        if (isPlayingRef.current) {
          fillVideoBuffer();
          fillAudioBuffer();
        }
      }, BUFFER_FILL_INTERVAL);
    }
    
    // Audio scheduling
    if (!audioScheduleIntervalRef.current) {
      audioScheduleIntervalRef.current = window.setInterval(() => {
        if (isPlayingRef.current) {
          scheduleAudioBuffers();
        }
      }, 50); // Schedule audio every 50ms
    }
  }, [renderFrame, fillVideoBuffer, fillAudioBuffer, scheduleAudioBuffers]);

  // Stop playback intervals
  const stopPlaybackIntervals = useCallback(() => {
    if (renderIntervalRef.current) {
      clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
    if (bufferFillIntervalRef.current) {
      clearInterval(bufferFillIntervalRef.current);
      bufferFillIntervalRef.current = null;
    }
    if (audioScheduleIntervalRef.current) {
      clearInterval(audioScheduleIntervalRef.current);
      audioScheduleIntervalRef.current = null;
    }
  }, []);

  // Play
  const play = useCallback(async () => {
    if (isPlayingRef.current) return;

    updateState({ isPlaying: true, buffering: true });

    // Resume audio context if suspended
    if (audioContextRef.current?.state === "suspended") {
      await audioContextRef.current.resume();
    }

    // Pre-fill buffers before starting
    await fillVideoBuffer();
    await fillAudioBuffer();
    
    // Wait for some frames to be ready
    let attempts = 0;
    while (frameBufferRef.current.length < 10 && attempts < 50) {
      await fillVideoBuffer();
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    isPlayingRef.current = true;

    // Initialize timing
    if (audioContextRef.current) {
      playbackStartTimeRef.current = audioContextRef.current.currentTime;
      nextAudioTimeRef.current = audioContextRef.current.currentTime;
    }
    
    // Start audio scheduling
    scheduleAudioBuffers();

    // Start playback intervals
    startPlaybackIntervals();

    updateState({ buffering: false });
  }, [fillVideoBuffer, fillAudioBuffer, scheduleAudioBuffers, startPlaybackIntervals, updateState]);

  // Pause
  const pause = useCallback(() => {
    isPlayingRef.current = false;
    updateState({ isPlaying: false });

    stopPlaybackIntervals();

    // Save current position
    if (audioContextRef.current) {
      const audioElapsed = audioContextRef.current.currentTime - playbackStartTimeRef.current;
      mediaStartTimeRef.current += audioElapsed * 1_000_000;
    }

    if (audioContextRef.current?.state === "running") {
      audioContextRef.current.suspend();
    }
  }, [stopPlaybackIntervals, updateState]);

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

      // Clear frame buffer
      for (const frame of frameBufferRef.current) {
        frame.close();
      }
      frameBufferRef.current = [];
      
      // Clear audio buffers
      audioBufferQueueRef.current = [];

      // Reset timing
      mediaStartTimeRef.current = newTime * 1_000_000;
      needsKeyframeRef.current = true;

      // Seek demuxers
      videoDemuxerRef.current?.seek(newTime);
      audioDemuxerRef.current?.seek(newTime);

      updateState({ currentTime: newTime });

      if (wasPlaying) {
        play();
      }
    },
    [pause, play, updateState]
  );

  const handleVolumeChange = useCallback(
    (value: number[]) => {
      const newVolume = value[0];
      updateState({ volume: newVolume, isMuted: newVolume === 0 });

      if (gainNodeRef.current) {
        gainNodeRef.current.gain.setValueAtTime(
          newVolume,
          audioContextRef.current?.currentTime || 0
        );
      }
    },
    [updateState]
  );

  const toggleMute = useCallback(() => {
    const newMuted = !state.isMuted;
    updateState({ isMuted: newMuted });

    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setValueAtTime(
        newMuted ? 0 : state.volume,
        audioContextRef.current?.currentTime || 0
      );
    }
  }, [state.isMuted, state.volume, updateState]);

  const toggleFullscreen = useCallback(() => {
    const container = canvasRef.current?.parentElement?.parentElement;
    if (container) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        container.requestFullscreen();
      }
    }
  }, []);

  const skipForward = useCallback(() => {
    handleSeek([Math.min(state.currentTime + 10, state.duration)]);
  }, [state.currentTime, state.duration, handleSeek]);

  const skipBackward = useCallback(() => {
    handleSeek([Math.max(state.currentTime - 10, 0)]);
  }, [state.currentTime, handleSeek]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Cleanup
  const cleanup = useCallback(() => {
    isCleanedUpRef.current = true;
    isPlayingRef.current = false;

    stopPlaybackIntervals();

    // Close video frames
    for (const frame of frameBufferRef.current) {
      try {
        frame.close();
      } catch {}
    }
    frameBufferRef.current = [];

    // Clear audio buffers
    audioBufferQueueRef.current = [];

    // Close decoders
    if (videoDecoderRef.current?.state !== "closed") {
      try {
        videoDecoderRef.current?.close();
      } catch {}
    }
    if (audioDecoderRef.current?.state !== "closed") {
      try {
        audioDecoderRef.current?.close();
      } catch {}
    }

    // Close audio context
    if (audioContextRef.current?.state !== "closed") {
      try {
        audioContextRef.current?.close();
      } catch {}
    }

    videoDecoderRef.current = null;
    audioDecoderRef.current = null;
    audioContextRef.current = null;
    gainNodeRef.current = null;
    videoDemuxerRef.current = null;
    audioDemuxerRef.current = null;
  }, [stopPlaybackIntervals]);

  // Initialize on mount
  useEffect(() => {
    initializePlayer();
    return cleanup;
  }, []);

  // Handle video URL changes
  useEffect(() => {
    cleanup();
    // Reset state
    chunksDecodedRef.current = 0;
    framesRenderedRef.current = 0;
    droppedFramesRef.current = 0;
    mediaStartTimeRef.current = 0;
    needsKeyframeRef.current = true;
    initializePlayer();
  }, [videoUrl]);

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      {/* Video Canvas */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          onClick={togglePlayPause}
        />

        {/* Loading Overlay */}
        {(state.isLoading || state.buffering) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="w-12 h-12 animate-spin text-white" />
          </div>
        )}

        {/* Error Overlay */}
        {state.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75">
            <div className="text-center text-white p-4">
              <p className="text-red-500 mb-2">Error</p>
              <p className="text-sm">{state.error}</p>
            </div>
          </div>
        )}

        {/* Debug Panel */}
        {showDebug && (
          <div className="absolute top-2 left-2 bg-black/80 text-white text-xs p-2 rounded font-mono max-w-xs">
            <div className="font-bold mb-1">Debug Panel (Streaming Audio)</div>
            <div>Video Decoder: {debugState.videoDecoderState}</div>
            <div>Audio Decoder: {debugState.audioDecoderState}</div>
            <div>Demuxer Ready: {debugState.demuxerReady ? "Yes" : "No"}</div>
            <div className="mt-1 font-bold">Buffers:</div>
            <div>Frame Buffer: {debugState.frameBufferSize}</div>
            <div>Audio Buffer: {debugState.audioBufferSize}</div>
            <div className="mt-1 font-bold">Stats:</div>
            <div>Chunks Decoded: {debugState.chunksDecoded}</div>
            <div>Frames Rendered: {debugState.framesRendered}</div>
            <div className={debugState.droppedFrames > 10 ? "text-red-400" : ""}>
              Dropped Frames: {debugState.droppedFrames}
            </div>
            <div className="mt-1 font-bold">Playback:</div>
            <div>Buffering: {state.buffering ? "Yes" : "No"}</div>
            <div>Playing: {state.isPlaying ? "Yes" : "No"}</div>
            {debugState.lastError && (
              <div className="mt-1 text-red-400 break-words">
                Error: {debugState.lastError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gradient-to-t from-black/90 to-transparent p-4">
        {/* Progress Bar */}
        <div className="mb-4">
          <Slider
            value={[state.currentTime]}
            max={state.duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{formatTime(state.currentTime)}</span>
            <span>{formatTime(state.duration)}</span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={skipBackward}
              className="text-white hover:bg-white/20"
            >
              <SkipBack className="w-5 h-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlayPause}
              className="text-white hover:bg-white/20"
              disabled={state.isLoading}
            >
              {state.isPlaying ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={skipForward}
              className="text-white hover:bg-white/20"
            >
              <SkipForward className="w-5 h-5" />
            </Button>

            <div className="flex items-center gap-2 ml-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleMute}
                className="text-white hover:bg-white/20"
              >
                {state.isMuted ? (
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
                className="w-24"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
              className="text-white hover:bg-white/20 text-xs"
            >
              {showDebug ? "Hide Debug" : "Show Debug"}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/20"
            >
              <Maximize className="w-5 h-5" />
            </Button>

            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-white hover:bg-white/20"
              >
                Close
              </Button>
            )}
          </div>
        </div>

        {/* Title */}
        {title && (
          <div className="mt-2 text-white text-sm truncate">{title}</div>
        )}
      </div>
    </div>
  );
}
