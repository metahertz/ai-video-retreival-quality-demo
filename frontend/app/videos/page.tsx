'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProcessingDialog } from '@/components/ProcessingDialog';
import { VideoUploadDialog } from '@/components/VideoUploadDialog';
import { videosApi, processApi } from '@/lib/api';
import type { YouTubeSearchResult, VideoResponse, ProcessJobStatus } from '@/lib/types';
import {
  Search, Download, Loader2, Trash2,
  AlertCircle, CheckCircle2, RefreshCw, Film, Layers, Sparkles, Activity, AlertTriangle, Upload,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViewCount(n: number | null | undefined): string {
  if (!n) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`;
  return `${n} views`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: VideoResponse['status'] }) {
  const map: Record<VideoResponse['status'], { label: string; cls: string }> = {
    downloaded: { label: 'Downloaded', cls: 'bg-blue-100 text-blue-800' },
    processing:  { label: 'Processing…', cls: 'bg-amber-100 text-amber-800' },
    completed:   { label: 'Embedded', cls: 'bg-emerald-100 text-emerald-800' },
    error:       { label: 'Error', cls: 'bg-red-100 text-red-800' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-muted text-muted-foreground' };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      {status === 'processing' && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'completed'  && <CheckCircle2 className="h-3 w-3" />}
      {status === 'error'      && <AlertCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

// ── YouTube search card ───────────────────────────────────────────────────────

interface YTCardProps {
  result: YouTubeSearchResult;
  isDownloading: boolean;
  isDownloaded: boolean;
  onDownload: () => void;
}

function YouTubeCard({ result, isDownloading, isDownloaded, onDownload }: YTCardProps) {
  return (
    <Card className="overflow-hidden group">
      <div className="relative aspect-video bg-muted">
        {result.thumbnail_url && (
          <Image
            src={result.thumbnail_url}
            alt={result.title}
            fill
            className="object-cover transition-opacity group-hover:opacity-90"
            unoptimized
          />
        )}
        {result.duration != null && (
          <div className="absolute bottom-1.5 right-1.5">
            <span className="text-xs bg-black/75 text-white px-1.5 py-0.5 rounded font-medium">
              {formatDuration(result.duration)}
            </span>
          </div>
        )}
        {isDownloaded && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-white drop-shadow" />
          </div>
        )}
      </div>

      <CardContent className="p-3 space-y-2">
        <p className="text-sm font-medium line-clamp-2 leading-snug">{result.title}</p>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{result.uploader}</span>
          <span className="shrink-0">{formatViewCount(result.view_count)}</span>
        </div>
        <Button
          size="sm"
          variant={isDownloaded ? 'outline' : 'default'}
          className="w-full"
          disabled={isDownloading || isDownloaded}
          onClick={onDownload}
        >
          {isDownloading ? (
            <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Downloading…</>
          ) : isDownloaded ? (
            <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />In library</>
          ) : (
            <><Download className="mr-1.5 h-3.5 w-3.5" />Download</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── My Videos card ────────────────────────────────────────────────────────────

interface LibraryCardProps {
  video: VideoResponse;
  isDeleting: boolean;
  onProcess: () => void;
  onViewProgress: () => void;
  onDelete: () => void;
}

function LibraryCard({ video, isDeleting, onProcess, onViewProgress, onDelete }: LibraryCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
    } else {
      clearTimeout(confirmTimer.current!);
      setConfirmDelete(false);
      onDelete();
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-muted">
        {video.thumbnail_url && (
          <Image
            src={video.thumbnail_url}
            alt={video.title}
            fill
            className="object-cover"
            unoptimized
          />
        )}

        {/* Status overlay for non-complete states */}
        {video.status === 'processing' && (
          <div
            className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1.5 cursor-pointer"
            onClick={onViewProgress}
          >
            <Loader2 className="h-6 w-6 text-white animate-spin" />
            <span className="text-xs text-white/90 font-medium">Processing…</span>
            <span className="text-xs text-white/60">Click for details</span>
          </div>
        )}

        {/* Duration badge */}
        {video.duration > 0 && (
          <div className="absolute bottom-1.5 right-1.5">
            <span className="text-xs bg-black/75 text-white px-1.5 py-0.5 rounded font-medium">
              {formatDuration(Math.round(video.duration))}
            </span>
          </div>
        )}

        {/* Segment count badge */}
        {video.status === 'completed' && video.segment_count > 0 && (
          <div className="absolute top-1.5 left-1.5">
            <span className="text-xs bg-emerald-600/90 text-white px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {video.segment_count} segments
            </span>
          </div>
        )}
      </div>

      <CardContent className="p-3 space-y-2.5">
        <p className="text-sm font-medium line-clamp-2 leading-snug">{video.title}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={video.status} />
          {video.chunking_strategy && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {video.chunking_strategy}
            </span>
          )}
        </div>

        {video.error_message && (
          <p className="text-xs text-destructive line-clamp-2 flex items-start gap-1">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            {video.error_message}
          </p>
        )}

        {video.file_missing && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-300/60 dark:border-amber-700/40 px-2.5 py-2 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-snug">
              Video file not found locally or in GridFS. Delete and re-download to restore.
            </p>
          </div>
        )}

        <div className="flex gap-1.5 pt-0.5">
          {video.status === 'processing' ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8"
              onClick={onViewProgress}
            >
              <Activity className="h-3.5 w-3.5 mr-1" />
              View Progress
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-8"
              onClick={onProcess}
              disabled={!!video.file_missing}
              title={video.file_missing ? 'Video file missing — delete and re-download first' : undefined}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              {video.status === 'completed' ? 'Re-embed' : 'Embed'}
            </Button>
          )}
          <Button
            size="sm"
            variant={confirmDelete ? 'destructive' : 'ghost'}
            className="h-8 px-2.5 text-xs shrink-0"
            onClick={handleDeleteClick}
            disabled={isDeleting}
            title={confirmDelete ? 'Click again to confirm deletion' : 'Delete video'}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : confirmDelete ? (
              'Sure?'
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function VideosPage() {
  const [activeTab, setActiveTab] = useState<'search' | 'library'>('search');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [myVideos, setMyVideos] = useState<VideoResponse[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [processTarget, setProcessTarget] = useState<VideoResponse | null>(null);
  const [processInitialJob, setProcessInitialJob] = useState<ProcessJobStatus | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMyVideos = useCallback(async (silent = false) => {
    if (!silent) setLoadingVideos(true);
    try {
      const videos = await videosApi.list();
      setMyVideos(videos);
    } catch {
    } finally {
      if (!silent) setLoadingVideos(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadMyVideos();
  }, [loadMyVideos]);

  // Auto-poll while any video is processing
  useEffect(() => {
    const hasProcessing = myVideos.some((v) => v.status === 'processing');
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(() => loadMyVideos(true), 3000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [myVideos, loadMyVideos]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    try {
      const results = await videosApi.search(query.trim(), 12);
      setSearchResults(results);
      if (results.length === 0) toast.info('No results found');
    } catch (e: any) {
      toast.error(e.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleDownload = async (result: YouTubeSearchResult) => {
    setDownloading((prev) => new Set(prev).add(result.youtube_id));
    try {
      await videosApi.download(result.youtube_id);
      toast.success(`"${result.title}" added to library`);
      await loadMyVideos(true);
      // Switch to library so the user sees it
      setActiveTab('library');
    } catch (e: any) {
      toast.error(e.message || 'Download failed');
    } finally {
      setDownloading((prev) => { const s = new Set(prev); s.delete(result.youtube_id); return s; });
    }
  };

  const handleDelete = async (video: VideoResponse) => {
    setDeleting((prev) => new Set(prev).add(video.id));
    try {
      await videosApi.delete(video.id);
      setMyVideos((vs) => vs.filter((v) => v.id !== video.id));
      toast.success('Video deleted');
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    } finally {
      setDeleting((prev) => { const s = new Set(prev); s.delete(video.id); return s; });
    }
  };

  const handleViewProgress = async (video: VideoResponse) => {
    try {
      const jobs = await processApi.listVideoJobs(video.id);
      const active = jobs.find((j) => j.status === 'pending' || j.status === 'processing');
      setProcessInitialJob(active ?? null);
    } catch {
      setProcessInitialJob(null);
    }
    setProcessTarget(video);
  };

  const isDownloaded = (youtubeId: string) => myVideos.some((v) => v.youtube_id === youtubeId);

  const processingCount = myVideos.filter((v) => v.status === 'processing').length;
  const embeddedCount   = myVideos.filter((v) => v.status === 'completed').length;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Videos</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Search YouTube, download videos, and embed them with VoyageAI.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'search' | 'library')}>
        <TabsList className="h-8 bg-muted/60 p-0.5 gap-0.5">
          <TabsTrigger value="search" className="text-xs h-7 px-2.5 gap-1.5">
            <Search className="h-3 w-3" />
            Search YouTube
          </TabsTrigger>
          <TabsTrigger value="library" className="text-xs h-7 px-2.5 gap-1.5">
            <Film className="h-3 w-3" />
            My Library
            {myVideos.length > 0 && (
              <Badge
                variant={processingCount > 0 ? 'default' : 'secondary'}
                className="text-xs px-1.5 py-0 h-4 min-w-[1.25rem]"
              >
                {processingCount > 0 ? (
                  <><Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />{myVideos.length}</>
                ) : myVideos.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Search tab ── */}
        <TabsContent value="search" className="space-y-5 mt-5">
          <div className="flex gap-2 max-w-lg">
            <Input
              placeholder="Search YouTube…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-2">Search</span>
            </Button>
          </div>

          {searching && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-lg overflow-hidden border bg-card animate-pulse">
                  <div className="aspect-video bg-muted" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-muted rounded w-full" />
                    <div className="h-3 bg-muted rounded w-2/3" />
                    <div className="h-8 bg-muted rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!searching && searchResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {searchResults.map((result) => (
                <YouTubeCard
                  key={result.youtube_id}
                  result={result}
                  isDownloading={downloading.has(result.youtube_id)}
                  isDownloaded={isDownloaded(result.youtube_id)}
                  onDownload={() => handleDownload(result)}
                />
              ))}
            </div>
          )}

          {!searching && hasSearched && searchResults.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No results found. Try a different search term.
            </p>
          )}

          {!hasSearched && (
            <div className="text-center py-16 text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Search YouTube for videos to embed</p>
              <p className="text-xs mt-1 opacity-70">
                Short videos (under 10 min) are fastest to process
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Library tab ── */}
        <TabsContent value="library" className="space-y-5 mt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>{myVideos.length} video{myVideos.length !== 1 ? 's' : ''}</span>
              {embeddedCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {embeddedCount} embedded
                </span>
              )}
              {processingCount > 0 && (
                <span className="flex items-center gap-1 text-amber-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {processingCount} processing
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUploadOpen(true)}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload Local File
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadMyVideos()}
                disabled={loadingVideos}
              >
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loadingVideos ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {loadingVideos ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg overflow-hidden border bg-card animate-pulse">
                  <div className="aspect-video bg-muted" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 bg-muted rounded w-full" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                    <div className="h-8 bg-muted rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : myVideos.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
              <Film className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">No videos yet</p>
              <p className="text-xs mt-1 mb-4 opacity-70">
                Search YouTube, or upload a local video file
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setActiveTab('search')}>
                  <Search className="h-3.5 w-3.5 mr-1.5" />
                  Search YouTube
                </Button>
                <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload File
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {myVideos.map((video) => (
                <LibraryCard
                  key={video.id}
                  video={video}
                  isDeleting={deleting.has(video.id)}
                  onProcess={() => { setProcessInitialJob(null); setProcessTarget(video); }}
                  onViewProgress={() => handleViewProgress(video)}
                  onDelete={() => handleDelete(video)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Upload dialog */}
      <VideoUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={(video) => {
          setMyVideos((vs) => [video, ...vs]);
          setUploadOpen(false);
          setActiveTab('library');
          import('sonner').then(({ toast }) => toast.success(`"${video.title}" added to library`));
        }}
      />

      {/* Processing dialog */}
      <ProcessingDialog
        video={processTarget}
        open={!!processTarget}
        initialJob={processInitialJob}
        onClose={() => {
          setProcessTarget(null);
          setProcessInitialJob(null);
          loadMyVideos(true);
        }}
        onComplete={async () => {
          await loadMyVideos(true);
          setProcessTarget(null);
          setProcessInitialJob(null);
        }}
      />
    </div>
  );
}
