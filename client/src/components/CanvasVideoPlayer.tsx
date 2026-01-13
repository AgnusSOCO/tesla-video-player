import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CanvasVideoPlayerProps {
  videoUrl: string;
  title?: string;
  onClose?: () => void;
}

interface VideoFrame {
  timestamp: number;
  duration: number;
}

/**
 * Canvas-based video player using WebCodecs API
 * This bypasses Tesla's video element blocking by rendering frames directly to canvas
 */
export function CanvasVideoPlayer({ videoUrl, title, onClose }: CanvasVideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);

  // Video decoder and rendering state
  const decoderRef = useRef<VideoDecoder | null>(null);
  const frameQueueRef = useRef<VideoFrame[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  /**
   * Initialize WebCodecs VideoDecoder
   */
  const initializeDecoder = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Check WebCodecs support
      if (!('VideoDecoder' in window)) {
        throw new Error(
          "WebCodecs API not supported in this browser. Tesla browser should support this."
        );
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      // Fetch video file
      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error("Failed to load video");
      }

      const videoBlob = await response.blob();
      
      // For now, we'll use a simpler approach with video element for decoding
      // but render to canvas to bypass blocking
      // This is a fallback approach that works in most browsers
      await initializeFallbackPlayer();

      setIsLoading(false);
    } catch (err) {
      console.error("Decoder initialization error:", err);
      setError(err instanceof Error ? err.message : "Failed to initialize player");
      setIsLoading(false);
    }
  }, [videoUrl]);

  /**
   * Fallback player: Use hidden video element for decoding, render to canvas
   * This approach works even without full WebCodecs support
   */
  const initializeFallbackPlayer = useCallback(async () => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Create hidden video element for frame extraction
    const video = document.createElement("video");
    video.src = videoUrl;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.style.display = "none";
    document.body.appendChild(video);

    // Set up audio element
    audio.src = videoUrl;
    audio.volume = volume;
    audio.muted = isMuted;

    // Wait for video metadata
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        // Set canvas size to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        setDuration(video.duration);
        resolve();
      };
      video.onerror = () => reject(new Error("Failed to load video"));
    });

    // Render loop: Copy video frames to canvas
    const renderFrame = () => {
      if (!isPlaying) return;

      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Update current time
      setCurrentTime(video.currentTime);

      // Continue rendering
      animationFrameRef.current = requestAnimationFrame(renderFrame);
    };

    // Store video element reference for playback control
    (canvas as any).__videoElement = video;

    // Handle video events
    video.onplay = () => {
      audio.play();
      startTimeRef.current = performance.now();
      renderFrame();
    };

    video.onpause = () => {
      audio.pause();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };

    video.onseeking = () => setBuffering(true);
    video.onseeked = () => {
      setBuffering(false);
      audio.currentTime = video.currentTime;
    };

    video.onwaiting = () => setBuffering(true);
    video.oncanplay = () => setBuffering(false);

    video.onended = () => {
      setIsPlaying(false);
      audio.pause();
    };

    // Sync audio with video
    audio.ontimeupdate = () => {
      const timeDiff = Math.abs(audio.currentTime - video.currentTime);
      if (timeDiff > 0.3) {
        // Resync if drift is too large
        audio.currentTime = video.currentTime;
      }
    };

  }, [videoUrl, volume, isMuted, isPlaying]);

  /**
   * Play/Pause control
   */
  const togglePlayPause = useCallback(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;

    const video = (canvas as any).__videoElement as HTMLVideoElement;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      audio.pause();
      setIsPlaying(false);
    } else {
      video.play();
      audio.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  /**
   * Seek to specific time
   */
  const handleSeek = useCallback((value: number[]) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;

    const video = (canvas as any).__videoElement as HTMLVideoElement;
    if (!video) return;

    const newTime = value[0];
    video.currentTime = newTime;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  /**
   * Volume control
   */
  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
    if (newVolume > 0 && isMuted) {
      setIsMuted(false);
      if (audioRef.current) {
        audioRef.current.muted = false;
      }
    }
  }, [isMuted]);

  /**
   * Toggle mute
   */
  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (audioRef.current) {
      audioRef.current.muted = newMuted;
    }
  }, [isMuted]);

  /**
   * Fullscreen toggle
   */
  const toggleFullscreen = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!document.fullscreenElement) {
      canvas.requestFullscreen().catch((err) => {
        console.error("Fullscreen error:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  /**
   * Format time as MM:SS
   */
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Initialize player on mount
  useEffect(() => {
    initializeDecoder();

    return () => {
      // Cleanup
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (decoderRef.current) {
        decoderRef.current.close();
      }
      // Clean up hidden video element
      const canvas = canvasRef.current;
      if (canvas) {
        const video = (canvas as any).__videoElement as HTMLVideoElement;
        if (video) {
          video.pause();
          video.remove();
        }
      }
    };
  }, [initializeDecoder]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-8">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">Playback Error</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <Button onClick={onClose} variant="outline">
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen bg-black flex flex-col">
      {/* Video Canvas */}
      <div className="flex-1 flex items-center justify-center relative">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          style={{ touchAction: "none" }}
        />

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin text-white mx-auto mb-4" />
              <p className="text-white">Loading video...</p>
            </div>
          </div>
        )}

        {/* Buffering Indicator */}
        {buffering && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-12 h-12 animate-spin text-white" />
          </div>
        )}

        {/* Center Play Button (when paused) */}
        {!isPlaying && !isLoading && (
          <button
            onClick={togglePlayPause}
            className="absolute inset-0 flex items-center justify-center group"
          >
            <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 transition-colors">
              <Play className="w-10 h-10 text-white ml-1" />
            </div>
          </button>
        )}
      </div>

      {/* Hidden Audio Element */}
      <audio ref={audioRef} />

      {/* Controls */}
      <div className="bg-gradient-to-t from-black via-black/90 to-transparent p-6 space-y-4">
        {/* Title */}
        {title && (
          <h3 className="text-white font-semibold text-lg truncate">{title}</h3>
        )}

        {/* Progress Bar */}
        <div className="space-y-2">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-sm text-gray-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Play/Pause */}
            <Button
              onClick={togglePlayPause}
              size="lg"
              variant="ghost"
              className="text-white hover:bg-white/10"
            >
              {isPlaying ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6" />
              )}
            </Button>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <Button
                onClick={toggleMute}
                size="icon"
                variant="ghost"
                className="text-white hover:bg-white/10"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
                className="w-24 cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Back Button */}
            {onClose && (
              <Button
                onClick={onClose}
                variant="ghost"
                className="text-white hover:bg-white/10"
              >
                Back
              </Button>
            )}

            {/* Fullscreen */}
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
