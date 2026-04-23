'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AdFormDialog from '@/components/AdFormDialog';
import AdMatchDialog from '@/components/AdMatchDialog';
import { adsApi } from '@/lib/api';
import type { AdResponse, PlacementResponse } from '@/lib/types';
import {
  Megaphone, Plus, Pencil, Trash2, Search, Loader2, Film, Clock,
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

export default function AdsPage() {
  // ── Library state ─────────────────────────────────────────────────────────
  const [ads, setAds] = useState<AdResponse[]>([]);
  const [loadingAds, setLoadingAds] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdResponse | null>(null);
  const [matchTarget, setMatchTarget] = useState<AdResponse | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [scoringEmotions, setScoringEmotions] = useState(false);

  // ── Placements state ──────────────────────────────────────────────────────
  const [placements, setPlacements] = useState<PlacementResponse[]>([]);
  const [loadingPlacements, setLoadingPlacements] = useState(true);
  const [deletingPlacementIds, setDeletingPlacementIds] = useState<Set<string>>(new Set());

  const loadAds = useCallback(async () => {
    try {
      const data = await adsApi.list();
      setAds(data);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load ads');
    } finally {
      setLoadingAds(false);
    }
  }, []);

  const loadPlacements = useCallback(async () => {
    try {
      const data = await adsApi.listPlacements();
      setPlacements(data);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load placements');
    } finally {
      setLoadingPlacements(false);
    }
  }, []);

  useEffect(() => {
    loadAds();
    loadPlacements();
  }, [loadAds, loadPlacements]);

  const handleScoreEmotions = async () => {
    setScoringEmotions(true);
    try {
      const result = await adsApi.scoreEmotions();
      toast.success(result.message);
    } catch (e: any) {
      toast.error(e.message || 'Emotion scoring failed');
    } finally {
      setScoringEmotions(false);
    }
  };

  const handleDeleteAd = async (id: string) => {
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await adsApi.delete(id);
      setAds((prev) => prev.filter((a) => a.id !== id));
      setPlacements((prev) => prev.filter((p) => p.ad_id !== id));
      toast.success('Ad deleted');
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete ad');
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleDeletePlacement = async (id: string) => {
    setDeletingPlacementIds((prev) => new Set(prev).add(id));
    try {
      await adsApi.deletePlacement(id);
      setPlacements((prev) => prev.filter((p) => p.id !== id));
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove placement');
    } finally {
      setDeletingPlacementIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ads</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Create text ads and semantically match them to video segments using voyage-multimodal-3.5 embeddings.
        </p>
      </div>

      <Tabs defaultValue="library">
        <TabsList className="h-8 bg-muted/60 p-0.5 gap-0.5">
          <TabsTrigger value="library" className="text-xs h-7 px-2.5">Ad Library</TabsTrigger>
          <TabsTrigger value="placements" className="text-xs h-7 px-2.5 gap-1.5">
            Placements
            {placements.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 min-w-[1.25rem]">
                {placements.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Ad Library ── */}
        <TabsContent value="library" className="mt-4 space-y-4">
          {/* Actions bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleScoreEmotions}
              disabled={scoringEmotions}
              title="Analyse the emotional tone of all processed videos so ads can be matched to compatible content"
            >
              {scoringEmotions
                ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Megaphone className="h-3.5 w-3.5 mr-1.5" />}
              Score Video Emotions
            </Button>
            <Button size="sm" onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Ad
            </Button>
          </div>

          {/* Loading */}
          {loadingAds && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading ads…</span>
            </div>
          )}

          {/* Empty state */}
          {!loadingAds && ads.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No ads yet</p>
              <p className="text-xs mt-1 opacity-70">
                Create an ad to start matching it against your video library
              </p>
            </div>
          )}

          {/* Ad cards grid */}
          {!loadingAds && ads.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {ads.map((ad) => {
                const isDeleting = deletingIds.has(ad.id);
                return (
                  <div key={ad.id} className="rounded-lg border bg-card p-4 flex flex-col gap-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm leading-tight">{ad.title}</h3>
                      <Badge variant="secondary" className="shrink-0 text-xs flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {ad.duration_seconds}s
                      </Badge>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {ad.description}
                    </p>

                    {/* Emotion tags */}
                    <div className="flex flex-wrap gap-1.5">
                      {ad.emotion_tags.map((t) => (
                        <span
                          key={t}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${EMOTION_COLORS[t] ?? 'bg-muted text-muted-foreground'}`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-auto pt-1 border-t">
                      <Button
                        size="sm"
                        className="flex-1 text-xs h-7"
                        onClick={() => setMatchTarget(ad)}
                      >
                        <Search className="h-3 w-3 mr-1" />
                        Find Matches
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => { setEditTarget(ad); setFormOpen(true); }}
                        title="Edit"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => handleDeleteAd(ad.id)}
                        disabled={isDeleting}
                        title="Delete"
                      >
                        {isDeleting
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Placements ── */}
        <TabsContent value="placements" className="mt-4 space-y-3">
          {loadingPlacements && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading placements…</span>
            </div>
          )}

          {!loadingPlacements && placements.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <Film className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No placements yet</p>
              <p className="text-xs mt-1 opacity-70">
                Use "Find Matches" on an ad to discover compatible video segments, then save placements
              </p>
            </div>
          )}

          {!loadingPlacements && placements.length > 0 && (
            <div className="space-y-2">
              {placements.map((p) => {
                const isDeleting = deletingPlacementIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border bg-card px-4 py-3 flex items-start gap-4"
                  >
                    {/* Ad info */}
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.ad_title}</span>
                        <span className="text-muted-foreground text-xs">→</span>
                        <span className="text-sm text-muted-foreground truncate">{p.video_title}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono">
                          @ {formatTime(p.start_time)}
                        </span>
                        <Badge variant="secondary" className="text-xs px-1.5">
                          {Math.round(p.match_score * 100)}% match
                        </Badge>
                        <Badge variant="outline" className="text-xs px-1.5">
                          {p.duration_seconds}s overlay
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1 italic">
                        &ldquo;{p.ad_description}&rdquo;
                      </p>
                    </div>

                    {/* Delete */}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeletePlacement(p.id)}
                      disabled={isDeleting}
                    >
                      {isDeleting
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AdFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null); }}
        onSaved={(ad) => {
          setAds((prev) =>
            editTarget
              ? prev.map((a) => (a.id === ad.id ? ad : a))
              : [ad, ...prev]
          );
          setFormOpen(false);
          setEditTarget(null);
        }}
        initial={editTarget}
      />

      <AdMatchDialog
        open={!!matchTarget}
        onClose={() => setMatchTarget(null)}
        ad={matchTarget}
        onPlacementSaved={loadPlacements}
      />
    </div>
  );
}
