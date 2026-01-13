import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CanvasVideoPlayer } from "@/components/CanvasVideoPlayer";
import { Loader2, Play, Trash2, Video as VideoIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function VideoLibrary() {
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [deleteVideoId, setDeleteVideoId] = useState<number | null>(null);

  // Fetch videos
  const { data: videos, isLoading, refetch } = trpc.videos.list.useQuery();

  // Get selected video details
  const { data: videoDetails } = trpc.videos.get.useQuery(
    { videoId: selectedVideo! },
    { enabled: !!selectedVideo }
  );

  // Delete mutation
  const deleteMutation = trpc.videos.delete.useMutation({
    onSuccess: () => {
      toast.success("Video deleted successfully");
      refetch();
      setDeleteVideoId(null);
    },
    onError: (error) => {
      toast.error(`Failed to delete video: ${error.message}`);
    },
  });

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return "N/A";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return "N/A";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  // Show video player if video is selected
  if (selectedVideo && videoDetails) {
    return (
      <CanvasVideoPlayer
        videoUrl={videoDetails.fileUrl}
        title={videoDetails.title}
        onClose={() => setSelectedVideo(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Tesla Video Player
              </h1>
              <p className="text-muted-foreground">
                Your video library - watch while driving
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">
                  {videos?.length || 0} videos
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Loading your videos...</p>
            </div>
          </div>
        ) : videos && videos.length > 0 ? (
          <div className="video-grid">
            {videos.map((video) => (
              <Card
                key={video.id}
                className="video-card group overflow-hidden"
                onClick={() => setSelectedVideo(video.id)}
              >
                {/* Thumbnail */}
                <div className="relative aspect-video bg-muted overflow-hidden">
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <VideoIcon className="w-16 h-16 text-muted-foreground" />
                    </div>
                  )}

                  {/* Play Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center">
                      <Play className="w-8 h-8 text-primary-foreground ml-1" />
                    </div>
                  </div>

                  {/* Duration Badge */}
                  {video.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                      {formatDuration(video.duration)}
                    </div>
                  )}
                </div>

                {/* Video Info */}
                <CardContent className="p-4">
                  <h3 className="font-semibold text-foreground line-clamp-2 mb-2">
                    {video.title}
                  </h3>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{formatFileSize(video.fileSize)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteVideoId(video.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <VideoIcon className="w-20 h-20 text-muted-foreground mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-foreground mb-3">
              No videos yet
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Send YouTube video links to the Telegram bot to start building your library.
            </p>
            <div className="bg-muted/50 rounded-lg p-6 max-w-md mx-auto text-left">
              <h3 className="font-semibold mb-3">How to add videos:</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Open the Telegram bot on your phone</li>
                <li>Send any YouTube video URL</li>
                <li>Wait for the download to complete</li>
                <li>Refresh this page to see your videos</li>
              </ol>
            </div>
          </div>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteVideoId !== null}
        onOpenChange={(open) => !open && setDeleteVideoId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Video</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this video? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteVideoId) {
                  deleteMutation.mutate({ videoId: deleteVideoId });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
