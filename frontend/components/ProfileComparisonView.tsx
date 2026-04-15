'use client';

import { useState } from 'react';
import type { CompareSearchResponse, SearchResult } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Film, Play } from 'lucide-react';

interface Props {
  data: CompareSearchResponse;
  onPlay: (result: SearchResult) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface CompareCardProps {
  result: SearchResult;
  rank: number;
  isShared: boolean;
  onPlay: (result: SearchResult) => void;
}

function CompareCard({ result, rank, isShared, onPlay }: CompareCardProps) {
  const [thumbError, setThumbError] = useState(false);
  const thumbnailSrc =
    result.thumbnail_url && !thumbError ? result.thumbnail_url : null;

  return (
    <div
      className={`rounded-lg border overflow-hidden text-xs ${
        isShared
          ? 'border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/10'
          : 'bg-card'
      }`}
    >
      {/* Thumbnail */}
      <div
        className="relative w-full aspect-video bg-muted flex items-center justify-center cursor-pointer group"
        onClick={() => onPlay(result)}
      >
        {thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt={`Segment ${result.segment_index + 1}`}
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <Film className="h-6 w-6 text-muted-foreground/30" />
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Play className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 fill-white transition-opacity" />
        </div>
        {/* Rank badge */}
        <div className="absolute top-1.5 left-1.5">
          <span className="bg-black/60 text-white text-[10px] font-bold rounded px-1.5 py-0.5">
            #{rank + 1}
          </span>
        </div>
        {/* Shared badge */}
        {isShared && (
          <div className="absolute top-1.5 right-1.5">
            <Badge
              variant="outline"
              className="text-[10px] py-0 px-1.5 border-amber-400 text-amber-600 bg-white/80"
            >
              shared
            </Badge>
          </div>
        )}
        {/* Score */}
        <div className="absolute bottom-1.5 right-1.5">
          <span className="bg-black/60 text-white text-[10px] font-mono rounded px-1.5 py-0.5">
            {result.score.toFixed(4)}
          </span>
        </div>
      </div>

      {/* Text content */}
      <div className="px-2.5 py-2 space-y-1">
        <div className="font-medium leading-snug line-clamp-2">{result.video_title}</div>
        <div className="text-muted-foreground font-mono text-[10px]">
          {formatTime(result.start_time)} – {formatTime(result.end_time)}
        </div>
        {result.caption_text && (
          <p className="text-muted-foreground line-clamp-2 leading-relaxed">
            {result.caption_text}
          </p>
        )}
      </div>
    </div>
  );
}


export default function ProfileComparisonView({ data, onPlay }: Props) {
  // Find segment IDs that appear in ≥2 profiles
  const idCounts = new Map<string, number>();
  for (const profile of data.profiles) {
    const seen = new Set<string>();
    for (const r of profile.results) {
      if (!seen.has(r.segment_id)) {
        seen.add(r.segment_id);
        idCounts.set(r.segment_id, (idCounts.get(r.segment_id) ?? 0) + 1);
      }
    }
  }
  const sharedIds = new Set<string>();
  idCounts.forEach((count, id) => {
    if (count >= 2) sharedIds.add(id);
  });

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {data.profiles.map((profile) => (
        <div
          key={profile.profile_key}
          className="flex-shrink-0 w-64 flex flex-col gap-2"
        >
          {/* Column header */}
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="font-semibold text-sm">{profile.label}</div>
            <div className="text-xs text-muted-foreground font-mono">{profile.profile_key}</div>
          </div>

          {/* Error state */}
          {profile.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-xs text-destructive flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{profile.error.includes('index') || profile.error.includes('Index')
                ? 'Index not ready — create indexes in Settings first.'
                : profile.error}
              </span>
            </div>
          )}

          {/* No results */}
          {!profile.error && profile.results.length === 0 && (
            <div className="rounded-lg border px-3 py-3 text-xs text-muted-foreground text-center">
              No results
            </div>
          )}

          {/* Result cards */}
          {profile.results.map((result, rank) => (
            <CompareCard
              key={result.segment_id}
              result={result}
              rank={rank}
              isShared={sharedIds.has(result.segment_id)}
              onPlay={onPlay}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
