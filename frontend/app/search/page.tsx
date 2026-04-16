'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { VideoCard } from '@/components/VideoCard';
import { VideoPlayer } from '@/components/VideoPlayer';
import ProfileComparisonView from '@/components/ProfileComparisonView';
import { searchApi, settingsApi } from '@/lib/api';
import { PROFILES, PROFILE_KEYS } from '@/lib/profiles';
import type { SearchResult, CompareSearchResponse, AllIndexStatusResponse, IndexCapacityInfo } from '@/lib/types';
import {
  Search, Loader2, Sparkles, AlignLeft, Info, GitCompare, CheckSquare, Square, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';

type SearchType = 'vector' | 'text';
type Mode = 'search' | 'compare';

export default function SearchPage() {
  // ── Shared state ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [playTarget, setPlayTarget] = useState<SearchResult | null>(null);

  // ── Index availability (drives adaptive UI) ───────────────────────────────
  const [indexStatus, setIndexStatus] = useState<AllIndexStatusResponse | null>(null);
  const [indexCapacity, setIndexCapacity] = useState<IndexCapacityInfo | null>(null);

  useEffect(() => {
    Promise.all([
      settingsApi.indexStatus().catch(() => null),
      settingsApi.indexCapacity().catch(() => null),
    ]).then(([status, capacity]) => {
      setIndexStatus(status);
      setIndexCapacity(capacity);
    });
  }, []);

  // Profiles that have a READY index. While loading, optimistically show all.
  const availableProfileKeys = indexStatus
    ? PROFILE_KEYS.filter(
        (k) => indexStatus.profiles.find((p) => p.profile_key === k)?.status === 'READY'
      )
    : PROFILE_KEYS;

  const textSearchAvailable = indexStatus
    ? indexStatus.text_index_status === 'READY'
    : true;

  // Small-cluster mode: at tier limit with some indexes still missing
  const isLimitedMode = !!(indexCapacity?.potentially_at_limit && !indexCapacity?.all_present);

  // Comparison requires at least 2 ready vector profiles
  const canCompare = availableProfileKeys.length >= 2;

  // ── Search mode ───────────────────────────────────────────────────────────
  const [searchType, setSearchType] = useState<SearchType>('vector');
  const [limit, setLimit] = useState(10);
  const [selectedProfile, setSelectedProfile] = useState('1024_float');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Compare mode ──────────────────────────────────────────────────────────
  const [compareProfiles, setCompareProfiles] = useState<string[]>([
    '1024_float', '512_float', '256_float',
  ]);
  const [compareLimit, setCompareLimit] = useState(5);
  const [comparing, setComparing] = useState(false);
  const [compareData, setCompareData] = useState<CompareSearchResponse | null>(null);
  const [hasCompared, setHasCompared] = useState(false);

  // Keep selectedProfile and compareProfiles in sync with what's actually available
  useEffect(() => {
    if (availableProfileKeys.length > 0 && !availableProfileKeys.includes(selectedProfile as any)) {
      setSelectedProfile(availableProfileKeys[0]);
    }
  }, [availableProfileKeys, selectedProfile]);

  useEffect(() => {
    if (availableProfileKeys.length > 0) {
      setCompareProfiles((prev) => {
        const filtered = prev.filter((k) => availableProfileKeys.includes(k as any));
        return filtered.length >= 1 ? filtered : availableProfileKeys.slice(0, 2);
      });
    }
  }, [availableProfileKeys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // If text search becomes unavailable and it's selected, switch to vector
  useEffect(() => {
    if (!textSearchAvailable && searchType === 'text') {
      setSearchType('vector');
    }
  }, [textSearchAvailable, searchType]);

  // If compare mode is active but no longer available, drop back to search
  useEffect(() => {
    if (!canCompare && mode === 'compare') {
      setMode('search');
    }
  }, [canCompare, mode]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await searchApi.search({
        query: query.trim(),
        search_type: searchType,
        limit,
        profile: searchType === 'vector' ? selectedProfile : undefined,
      });
      setResults(res);
      if (res.length === 0) toast.info('No results found');
    } catch (e: any) {
      toast.error(e.message || 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleCompare = async () => {
    if (!query.trim()) return;
    if (compareProfiles.length === 0) {
      toast.error('Select at least one profile');
      return;
    }
    setComparing(true);
    setHasCompared(true);
    try {
      const res = await searchApi.compare({
        query: query.trim(),
        profiles: compareProfiles,
        limit: compareLimit,
      });
      setCompareData(res);
    } catch (e: any) {
      toast.error(e.message || 'Compare failed');
    } finally {
      setComparing(false);
    }
  };

  const toggleCompareProfile = (key: string) => {
    setCompareProfiles((prev) =>
      prev.includes(key)
        ? prev.length > 1 ? prev.filter((k) => k !== key) : prev
        : [...prev, key]
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'search') handleSearch();
      else handleCompare();
    }
  };

  // ── Shared query input bar ────────────────────────────────────────────────

  const isRunning = mode === 'search' ? searching : comparing;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Search across embedded video segments using vector or full-text search.
        </p>
      </div>

      {/* Limited-mode hint banner */}
      {isLimitedMode && (
        <div className="flex items-start gap-2 text-xs bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2.5 text-blue-800 dark:text-blue-200">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-500" />
          <span>
            Running with a limited index set — your cluster tier (M0/M2/M5) supports{' '}
            {indexCapacity?.tier_limit ?? 3} of the {indexCapacity?.total_needed ?? 6} required indexes.{' '}
            {availableProfileKeys.length} vector profile{availableProfileKeys.length !== 1 ? 's' : ''} available
            {textSearchAvailable ? ' + text search' : ''}.{' '}
            Upgrade to M10+ to unlock all profiles and cross-profile comparison.{' '}
            <Link href="/settings" className="font-medium underline inline-flex items-center gap-0.5">
              Settings <ArrowRight className="h-3 w-3" />
            </Link>
          </span>
        </div>
      )}

      {/* Mode switcher — Compare only shown when 2+ profiles are available */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'search' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('search')}
        >
          <Search className="h-3.5 w-3.5 mr-1.5" />
          Search
        </Button>
        {canCompare && (
          <Button
            variant={mode === 'compare' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('compare')}
          >
            <GitCompare className="h-3.5 w-3.5 mr-1.5" />
            Compare Profiles
          </Button>
        )}
      </div>

      {/* ── Search mode controls ── */}
      {mode === 'search' && (
        <div className="space-y-3 max-w-2xl">
          {/* Search type */}
          <div className="flex gap-2">
            <Button
              variant={searchType === 'vector' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSearchType('vector')}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Vector Search
            </Button>
            {textSearchAvailable && (
              <Button
                variant={searchType === 'text' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSearchType('text')}
              >
                <AlignLeft className="h-3.5 w-3.5 mr-1.5" />
                Text Search
              </Button>
            )}
          </div>

          {searchType === 'text' && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Text search matches against caption text. Only caption-chunked segments are searchable.</span>
            </div>
          )}

          {/* Profile selector — vector only, filtered to available */}
          {searchType === 'vector' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Retrieval Profile</Label>
              <div className="flex flex-wrap gap-2">
                {availableProfileKeys.map((key) => {
                  const p = PROFILES[key];
                  const active = selectedProfile === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedProfile(key)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                      }`}
                    >
                      <span className="font-medium">{p.label}</span>
                      <span className="ml-1.5 opacity-60">{p.costNote}</span>
                    </button>
                  );
                })}
                {availableProfileKeys.length === 0 && indexStatus && (
                  <span className="text-xs text-muted-foreground">
                    No vector indexes ready — visit{' '}
                    <Link href="/settings" className="underline">Settings</Link> to create them.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Query + submit */}
          <div className="flex gap-2">
            <Input
              placeholder={
                searchType === 'vector'
                  ? "Describe what you're looking for…"
                  : 'Enter keywords to find in captions…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2 hidden sm:inline">Search</span>
            </Button>
          </div>

          {/* Limit */}
          <div className="flex items-center gap-4">
            <Label className="text-xs text-muted-foreground w-16 shrink-0">Results: {limit}</Label>
            <Slider
              min={5} max={50} step={5}
              value={[limit]}
              onValueChange={(v) => setLimit(Array.isArray(v) ? v[0] : (v as number))}
              className="w-48"
            />
          </div>
        </div>
      )}

      {/* ── Compare mode controls ── */}
      {mode === 'compare' && (
        <div className="space-y-3 max-w-2xl">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Profiles to compare (select 2–{Math.min(5, availableProfileKeys.length)})
            </Label>
            <div className="space-y-1.5">
              {availableProfileKeys.map((key) => {
                const p = PROFILES[key];
                const checked = compareProfiles.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleCompareProfile(key)}
                    className="flex items-center gap-2.5 w-full text-left text-sm hover:bg-muted/50 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    {checked
                      ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                      : <Square className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className={`font-medium ${checked ? '' : 'text-muted-foreground'}`}>
                      {p.label}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">{p.costNote}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Query + submit */}
          <div className="flex gap-2">
            <Input
              placeholder="Describe what you're looking for across profiles…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button onClick={handleCompare} disabled={comparing || !query.trim()}>
              {comparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
              <span className="ml-2 hidden sm:inline">Compare</span>
            </Button>
          </div>

          {/* Per-profile limit */}
          <div className="flex items-center gap-4">
            <Label className="text-xs text-muted-foreground w-24 shrink-0">
              Per profile: {compareLimit}
            </Label>
            <Slider
              min={3} max={20} step={1}
              value={[compareLimit]}
              onValueChange={(v) => setCompareLimit(Array.isArray(v) ? v[0] : (v as number))}
              className="w-48"
            />
          </div>
        </div>
      )}

      {/* ── Search results ── */}
      {mode === 'search' && (
        <>
          {searching && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">
                {searchType === 'vector' ? 'Computing embeddings and searching…' : 'Searching…'}
              </span>
            </div>
          )}

          {!searching && hasSearched && results.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No results found. Try a different query or check that videos have been processed.</p>
            </div>
          )}

          {!searching && results.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                {results.length} result{results.length !== 1 ? 's' : ''} for &quot;{query}&quot;
                {searchType === 'vector' && (
                  <span className="ml-2 text-xs">
                    — {PROFILES[selectedProfile as keyof typeof PROFILES]?.label ?? selectedProfile}
                  </span>
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {results.map((result) => (
                  <VideoCard
                    key={result.segment_id}
                    result={result}
                    onPlay={setPlayTarget}
                  />
                ))}
              </div>
            </>
          )}

          {!hasSearched && (
            <div className="text-center py-20 text-muted-foreground">
              <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Search your video library</p>
              <p className="text-xs mt-1 opacity-70">
                Enter a description to find semantically similar video segments
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Compare results ── */}
      {mode === 'compare' && (
        <>
          {comparing && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Searching across {compareProfiles.length} profiles…</span>
            </div>
          )}

          {!comparing && hasCompared && compareData && (
            <>
              <p className="text-sm text-muted-foreground">
                Comparison for &quot;{compareData.query}&quot; across {compareData.profiles.length} profiles.{' '}
                <span className="text-amber-600">Amber</span> = segment appears in ≥2 profiles.
              </p>
              <ProfileComparisonView
                data={compareData}
                onPlay={setPlayTarget}
              />
            </>
          )}

          {!hasCompared && (
            <div className="text-center py-20 text-muted-foreground">
              <GitCompare className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Compare retrieval profiles</p>
              <p className="text-xs mt-1 opacity-70">
                Run the same query across multiple dimension/quantisation configurations to see rank drift
              </p>
            </div>
          )}
        </>
      )}

      {/* Shared video player modal */}
      <VideoPlayer
        result={playTarget}
        open={!!playTarget}
        onClose={() => setPlayTarget(null)}
      />
    </div>
  );
}
