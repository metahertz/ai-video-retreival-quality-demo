'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SearchResult } from '@/lib/types';
import { Clock, Play, Film, ExternalLink } from 'lucide-react';

interface VideoCardProps {
  result: SearchResult;
  onPlay: (result: SearchResult) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const strategyColors: Record<string, string> = {
  whole: 'bg-blue-100 text-blue-800',
  caption: 'bg-purple-100 text-purple-800',
  scene: 'bg-orange-100 text-orange-800',
  fixed: 'bg-gray-100 text-gray-800',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export function VideoCard({ result, onPlay }: VideoCardProps) {
  const [thumbError, setThumbError] = useState(false);
  const scorePercent = (result.score * 100).toFixed(1);
  const strategyClass = strategyColors[result.chunking_strategy] ?? strategyColors.fixed;
  const segDuration = result.end_time - result.start_time;

  // Build absolute thumbnail URL from the relative path returned by the API
  const thumbnailSrc =
    result.thumbnail_url && !thumbError
      ? `${API_BASE}${result.thumbnail_url}`
      : null;

  return (
    <Card
      className="group cursor-pointer hover:shadow-md transition-all hover:border-primary/40 overflow-hidden"
      onClick={() => onPlay(result)}
    >
      {/* Thumbnail */}
      <div className="relative bg-muted w-full aspect-video flex items-center justify-center overflow-hidden">
        {thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt={`Thumbnail for ${result.video_title} at ${formatTime(result.start_time)}`}
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <Film className="h-10 w-10 text-muted-foreground/30" />
        )}

        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/40 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="h-6 w-6 text-white fill-white" />
          </div>
        </div>

        {/* Score badge — top right */}
        <div className="absolute top-2 right-2 z-10">
          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-xs tabular-nums">
            {scorePercent}%
          </Badge>
        </div>

        {/* Time range — bottom left */}
        <div className="absolute bottom-2 left-2 z-10">
          <Badge variant="outline" className="bg-black/60 text-white border-white/20 text-xs gap-1">
            <Clock className="h-2.5 w-2.5" />
            {formatTime(result.start_time)} – {formatTime(result.end_time)}
          </Badge>
        </div>

        {/* Duration — bottom right */}
        <div className="absolute bottom-2 right-2 z-10">
          <span className="text-[10px] text-white/70 font-mono tabular-nums">
            {segDuration < 60
              ? `${segDuration.toFixed(0)}s`
              : `${Math.floor(segDuration / 60)}m${(segDuration % 60).toFixed(0).padStart(2, '0')}s`}
          </span>
        </div>
      </div>

      {/* Metadata */}
      <CardContent className="p-3 space-y-2">
        {/* Title */}
        <p className="font-medium text-sm leading-snug line-clamp-2">{result.video_title}</p>

        {/* Caption snippet */}
        {result.caption_text && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {result.caption_text}
          </p>
        )}

        {/* Tags row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${strategyClass}`}>
            {result.chunking_strategy}
          </span>
          <span className="text-xs text-muted-foreground">
            Seg {result.segment_index + 1}
          </span>
        </div>

        {/* Bottom meta row: date + YouTube link */}
        <div className="flex items-center justify-between pt-0.5 border-t border-border/50">
          {result.created_at ? (
            <span className="text-[11px] text-muted-foreground">
              Embedded {formatDate(result.created_at)}
            </span>
          ) : (
            <span />
          )}
          {result.youtube_url && (
            <a
              href={result.youtube_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              title="Open on YouTube"
            >
              <ExternalLink className="h-3 w-3" />
              YouTube
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
