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

interface NativeVideoPlayerProps {
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

/**
 * NativeVideoPlayer - Bypasses Tesla's driving video restrictions
 * 
 * How it works:
 * 1. Uses a HIDDEN <video> element to load and decode the video
 * 2. Uses requestAnimationFrame to draw video frames to a visible <canvas>
 * 3. Routes audio through Web Audio API for playback
 * 
 * Why this works on Tesla while driving:
 * - Tesla blocks the <video> element from being DISPLAYED while driving
 * - But the <video> element can still DECODE video in the background
 * - Canvas rendering is NOT blocked while driving
 * - Web Audio API is NOT blocked while driving
 * 
 * This is the same technique used by FSD Theater and similar apps.
 */
export function NativeVideoPlayer({
  videoUrl,
  title,
  onClose,
}: NativeVideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const [showDebug, setShowDebug] = useState(true);
  const [debugInfo, setDebugInfo] = useState({
    fps: 0,
    framesRendered: 0,
    videoReadyState: 0,
    canvasSize: "0x0",
    audioState: "not initialized",
  });

  const framesRenderedRef = useRef(0);
  const lastFpsUpdateRef = useRef(0);
  const fpsCounterRef = useRef(0);

  const updateState = useCallback((updates: Partial<PlayerState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Draw video frame to canvas
  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      animationFrameRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) {
      animationFrameRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    // Only draw if video has data
    if (video.readyState >= 2) {
      // HAVE_CURRENT_DATA or better
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      framesRenderedRef.current++;
      fpsCounterRef.current++;
    }

    // Update current time from video element
    if (!video.paused) {
      updateState({ 
        currentTime: video.currentTime,
        buffering: video.readyState < 3, // HAVE_FUTURE_DATA
      });
    }

    // Update FPS counter every second
    const now = performance.now();
    if (now - lastFpsUpdateRef.current >= 1000) {
      setDebugInfo(prev => ({
        ...prev,
        fps: fpsCounterRef.current,
        framesRendered: framesRenderedRef.current,
        videoReadyState: video.readyState,
        canvasSize: `${canvas.width}x${canvas.height}`,
        audioState: audioContextRef.current?.state || "not initialized",
      }));
      fpsCounterRef.current = 0;
      lastFpsUpdateRef.current = now;
    }

    // Continue the render loop
    animationFrameRef.current = requestAnimationFrame(drawFrame);
  }, [updateState]);

  // Initialize audio routing through Web Audio API
  const initializeAudio = useCallback(() => {
    const video = videoRef.current;
    if (!video || audioContextRef.current) return;

    try {
      // Create AudioContext
      audioContextRef.current = new AudioContext();
      
      // Create media element source from the video
      audioSourceRef.current = audioContextRef.current.createMediaElementSource(video);
      
      // Create gain node for volume control
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = state.volume;
      
      // Connect: video -> gain -> destination (speakers)
      audioSourceRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(audioContextRef.current.destination);
      
      console.log("Audio initialized successfully");
    } catch (err) {
      console.error("Failed to initialize audio:", err);
    }
  }, [state.volume]);

  // Initialize player
  const initializePlayer = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas) {
      updateState({ error: "Video or canvas element not available" });
      return;
    }

    // Set video source
    video.src = videoUrl;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    
    // Handle video metadata loaded
    video.onloadedmetadata = () => {
      // Set canvas size to match video
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      
      updateState({
        duration: video.duration,
        isLoading: false,
      });
      
      console.log(`Video loaded: ${video.videoWidth}x${video.videoHeight}, duration: ${video.duration}s`);
    };

    // Handle video can play
    video.oncanplay = () => {
      updateState({ buffering: false });
    };

    // Handle video waiting (buffering)
    video.onwaiting = () => {
      updateState({ buffering: true });
    };

    // Handle video playing
    video.onplaying = () => {
      updateState({ buffering: false, isPlaying: true });
    };

    // Handle video pause
    video.onpause = () => {
      updateState({ isPlaying: false });
    };

    // Handle video ended
    video.onended = () => {
      updateState({ isPlaying: false });
    };

    // Handle errors
    video.onerror = () => {
      const errorMessage = video.error?.message || "Unknown video error";
      console.error("Video error:", errorMessage);
      updateState({ 
        error: `Video error: ${errorMessage}`,
        isLoading: false,
      });
    };

    // Start loading
    video.load();
    
    // Start the render loop
    animationFrameRef.current = requestAnimationFrame(drawFrame);
  }, [videoUrl, updateState, drawFrame]);

  // Play video
  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      // Initialize audio on first play (requires user interaction)
      if (!audioContextRef.current) {
        initializeAudio();
      }
      
      // Resume audio context if suspended
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }

      await video.play();
      updateState({ isPlaying: true });
    } catch (err) {
      console.error("Play error:", err);
      updateState({ error: `Play error: ${err instanceof Error ? err.message : String(err)}` });
    }
  }, [initializeAudio, updateState]);

  // Pause video
  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    updateState({ isPlaying: false });
  }, [updateState]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [state.isPlaying, play, pause]);

  // Seek to position
  const handleSeek = useCallback((value: number[]) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = value[0];
    video.currentTime = newTime;
    updateState({ currentTime: newTime });
  }, [updateState]);

  // Handle volume change
  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVolume;
    }
    
    updateState({ volume: newVolume, isMuted: newVolume === 0 });
  }, [updateState]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const newMuted = !state.isMuted;
    
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newMuted ? 0 : state.volume;
    }
    
    updateState({ isMuted: newMuted });
  }, [state.isMuted, state.volume, updateState]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  // Skip forward 10 seconds
  const skipForward = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.min(video.currentTime + 10, video.duration);
    }
  }, []);

  // Skip backward 10 seconds
  const skipBackward = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.max(video.currentTime - 10, 0);
    }
  }, []);

  // Format time for display
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Cleanup
  const cleanup = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop video
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.src = "";
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    audioSourceRef.current = null;
    gainNodeRef.current = null;
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializePlayer();
    
    return () => {
      cleanup();
    };
  }, [initializePlayer, cleanup]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlayPause();
          break;
        case "ArrowLeft":
          skipBackward();
          break;
        case "ArrowRight":
          skipForward();
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayPause, skipBackward, skipForward, toggleMute, toggleFullscreen]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black flex flex-col"
    >
      {/* Hidden video element - does the actual decoding */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        crossOrigin="anonymous"
      />

      {/* Visible canvas - displays the video frames */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          onClick={togglePlayPause}
        />

        {/* Loading overlay */}
        {state.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="w-12 h-12 animate-spin text-white" />
          </div>
        )}

        {/* Buffering overlay */}
        {state.buffering && !state.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
          </div>
        )}

        {/* Error overlay */}
        {state.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="text-center text-white p-4">
              <p className="text-red-500 mb-2">Error</p>
              <p className="text-sm">{state.error}</p>
            </div>
          </div>
        )}

        {/* Play button overlay when paused */}
        {!state.isPlaying && !state.isLoading && !state.error && (
          <div
            className="absolute inset-0 flex items-center justify-center cursor-pointer"
            onClick={togglePlayPause}
          >
            <div className="bg-white/20 rounded-full p-4">
              <Play className="w-16 h-16 text-white" />
            </div>
          </div>
        )}
      </div>

      {/* Debug panel */}
      {showDebug && (
        <div className="absolute top-2 left-2 bg-black/80 text-white text-xs p-2 rounded font-mono max-w-xs">
          <div className="font-bold mb-1">Debug Panel (Native Video + Canvas)</div>
          <div>FPS: {debugInfo.fps}</div>
          <div>Frames Rendered: {debugInfo.framesRendered}</div>
          <div>Video Ready State: {debugInfo.videoReadyState}</div>
          <div>Canvas Size: {debugInfo.canvasSize}</div>
          <div>Audio State: {debugInfo.audioState}</div>
          <div>Buffering: {state.buffering ? "Yes" : "No"}</div>
          <div>Playing: {state.isPlaying ? "Yes" : "No"}</div>
          <button
            className="mt-1 text-blue-400 underline"
            onClick={() => setShowDebug(false)}
          >
            Hide Debug
          </button>
        </div>
      )}

      {!showDebug && (
        <button
          className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded"
          onClick={() => setShowDebug(true)}
        >
          Show Debug
        </button>
      )}

      {/* Controls */}
      <div className="bg-gradient-to-t from-black/80 to-transparent p-4">
        {/* Title */}
        {title && (
          <div className="text-white text-sm mb-2 truncate">{title}</div>
        )}

        {/* Progress bar */}
        <div className="mb-3">
          <Slider
            value={[state.currentTime]}
            max={state.duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-white text-xs mt-1">
            <span>{formatTime(state.currentTime)}</span>
            <span>{formatTime(state.duration)}</span>
          </div>
        </div>

        {/* Control buttons */}
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
          </div>

          <div className="flex items-center gap-2">
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

            <div className="w-24">
              <Slider
                value={[state.isMuted ? 0 : state.volume]}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
              />
            </div>

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
      </div>
    </div>
  );
}
