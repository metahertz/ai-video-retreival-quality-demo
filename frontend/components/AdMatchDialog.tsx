'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { adsApi } from '@/lib/api';
import type { AdMatchSegment, AdResponse, EmotionTag } from '@/lib/types';
import {
  Loader2, Film, Check, X, HelpCircle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

const EMOTION_COLORS: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  neutral:  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  intense:  'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  negative: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface AdMatchDialogProps {
  open: boolean;
  onClose: () => void;
  ad: AdResponse | null;
  onPlacementSaved: () => void;
}

export default function AdMatchDialog({ open, onClose, ad, onPlacementSaved }: AdMatchDialogProps) {
  const [limit, setLimit] = useState(10);
  const [results, setResults] = useState<AdMatchSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [thumbErrors, setThumbErrors] = useState<Set<string>>(new Set());

  const runMatch = useCallback(async () => {
    if (!ad) return;
    setLoading(true);
    setResults([]);
    setThumbErrors(new Set());
    try {
      const res = await adsApi.match(ad.id, limit);
      setResults(res);
      if (res.length === 0) toast.info('No matching segments found');
    } catch (e: any) {
      toast.error(e.message || 'Match failed');
    } finally {
      setLoading(false);
    }
  }, [ad, limit]);

  // Auto-run when dialog opens with a new ad
  useEffect(() => {
    if (open && ad) {
      setSavedIds(new Set());
      setResults([]);
      runMatch();
    }
  }, [open, ad]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSavePlacement = async (seg: AdMatchSegment) => {
    if (!ad) return;
    setSavingId(seg.segment_id);
    try {
      await adsApi.createPlacement({
        ad_id: ad.id,
        segment_id: seg.segment_id,
        video_id: seg.video_id,
        segment_index: seg.segment_index,
        start_time: seg.start_time,
        match_score: seg.match_score,
      });
      setSavedIds((prev) => new Set(prev).add(seg.segment_id));
      onPlacementSaved();
      toast.success('Placement saved');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save placement');
    } finally {
      setSavingId(null);
    }
  };

  if (!ad) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Match Segments — {ad.title}</DialogTitle>
        </DialogHeader>

        {/* Ad preview */}
        <div className="shrink-0 rounded-lg border bg-muted/30 px-4 py-3 space-y-1.5">
          <p className="text-sm leading-relaxed text-foreground">&ldquo;{ad.description}&rdquo;</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">{ad.duration_seconds}s overlay</Badge>
            <span className="text-xs text-muted-foreground">compatible with:</span>
            {ad.emotion_tags.map((t) => (
              <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-medium ${EMOTION_COLORS[t] ?? ''}`}>
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="shrink-0 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Results: {limit}</Label>
            <Slider
              min={5} max={50} step={5}
              value={[limit]}
              onValueChange={(v) => setLimit(Array.isArray(v) ? v[0] : (v as number))}
              className="w-36"
            />
          </div>
          <Button size="sm" variant="outline" onClick={runMatch} disabled={loading}>
            {loading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">{loading ? 'Matching…' : 'Re-run'}</span>
          </Button>
          {results.length > 0 && !loading && (
            <span className="text-xs text-muted-foreground">{results.length} segment{results.length !== 1 ? 's' : ''} found</span>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Finding matching segments…</span>
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No results yet — click Re-run to search.
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pb-2">
              {results.map((seg) => {
                const saved = savedIds.has(seg.segment_id);
                const isSaving = savingId === seg.segment_id;
                const thumbOk = !!seg.thumbnail_url && !thumbErrors.has(seg.segment_id);
                return (
                  <div key={seg.segment_id} className="rounded-lg border bg-card overflow-hidden flex flex-col">
                    {/* Thumbnail */}
                    <div className="relative aspect-video bg-muted shrink-0">
                      {thumbOk ? (
                        <img
                          src={seg.thumbnail_url!}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={() => setThumbErrors((prev) => new Set(prev).add(seg.segment_id))}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="h-8 w-8 text-muted-foreground/30" />
                        </div>
                      )}
                      {/* Score badge */}
                      <span className="absolute top-1.5 right-1.5 rounded-full bg-emerald-600 text-white text-xs px-1.5 py-0.5 font-medium">
                        {Math.round(seg.match_score * 100)}%
                      </span>
                      {/* Emotion compatible badge */}
                      <span className="absolute top-1.5 left-1.5">
                        {seg.emotion_compatible === true && (
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-emerald-600/90">
                            <Check className="h-3 w-3 text-white" />
                          </span>
                        )}
                        {seg.emotion_compatible === false && (
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-red-600/90">
                            <X className="h-3 w-3 text-white" />
                          </span>
                        )}
                        {seg.emotion_compatible === null && (
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-muted-foreground/50">
                            <HelpCircle className="h-3 w-3 text-white" />
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <p className="text-xs font-medium line-clamp-2 leading-snug">{seg.video_title}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono">
                          {formatTime(seg.start_time)}–{formatTime(seg.end_time)}
                        </span>
                        {seg.emotion_dominant ? (
                          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${EMOTION_COLORS[seg.emotion_dominant] ?? 'bg-muted text-muted-foreground'}`}>
                            {seg.emotion_dominant}
                          </span>
                        ) : (
                          <span className="rounded-full px-1.5 py-0.5 text-xs text-muted-foreground bg-muted">
                            unscored
                          </span>
                        )}
                      </div>
                      {seg.caption_text && (
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">{seg.caption_text}</p>
                      )}
                      <Button
                        size="sm"
                        variant={saved ? 'secondary' : 'default'}
                        className="w-full mt-auto text-xs h-8"
                        disabled={saved || isSaving}
                        onClick={() => handleSavePlacement(seg)}
                      >
                        {isSaving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        {saved ? 'Placed' : 'Place Ad Here'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
