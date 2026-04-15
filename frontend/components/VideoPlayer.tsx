'use client';

import { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { videosApi } from '@/lib/api';
import type { SearchResult } from '@/lib/types';
import { Clock, Film } from 'lucide-react';

interface VideoPlayerProps {
  result: SearchResult | null;
  open: boolean;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VideoPlayer({ result, open, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (open && videoRef.current) {
      videoRef.current.load();
    }
  }, [open, result]);

  if (!result) return null;

  const isWholeVideo = result.chunking_strategy === 'whole';
  const src = isWholeVideo
    ? videosApi.streamUrl(result.video_id)
    : videosApi.segmentStreamUrl(result.video_id, result.segment_index);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-base leading-snug pr-8">{result.video_title}</DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-1 flex flex-wrap gap-2 items-center">
          <Badge variant="outline" className="text-xs gap-1">
            <Clock className="h-3 w-3" />
            {formatTime(result.start_time)} – {formatTime(result.end_time)}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {result.chunking_strategy}
          </Badge>
          <Badge className="text-xs bg-emerald-600 hover:bg-emerald-700">
            {(result.score * 100).toFixed(1)}% match
          </Badge>
        </div>

        {/* Video */}
        <div className="bg-black w-full aspect-video">
          <video
            ref={videoRef}
            className="w-full h-full"
            controls
            autoPlay
            playsInline
          >
            <source src={src} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>

        {result.caption_text && (
          <div className="px-6 py-4 border-t bg-muted/30">
            <div className="flex items-start gap-2">
              <Film className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                {result.caption_text}
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
