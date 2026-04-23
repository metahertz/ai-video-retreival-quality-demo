'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/lib/api';
import type { SettingsRequest, ConnectionTestResult, AllIndexStatusResponse, IndexCapacityInfo } from '@/lib/types';
import {
  Eye, EyeOff, Loader2, CheckCircle2, XCircle, RefreshCw,
  Database, Key, Layers, AlertTriangle, ExternalLink, Play, Upload, Trash2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsRequest>({
    voyage_api_key: '',
    mongodb_uri: '',
    mongodb_db: 'voyage_video_demo',
    mongodb_collection_videos: 'videos',
    mongodb_collection_segments: 'video_segments',
    yt_dlp_cookies_browser: '',
    yt_dlp_cookies_file: '',
  });
  const [showVoyageKey, setShowVoyageKey] = useState(false);
  const [showMongoUri, setShowMongoUri] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [creatingIndexes, setCreatingIndexes] = useState(false);
  const [indexStatus, setIndexStatus] = useState<AllIndexStatusResponse | null>(null);
  const [indexCapacity, setIndexCapacity] = useState<IndexCapacityInfo | null>(null);
  const [indexLimitHit, setIndexLimitHit] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillingThumbs, setBackfillingThumbs] = useState(false);
  const [uploadingCookies, setUploadingCookies] = useState(false);
  const [deletingCookies, setDeletingCookies] = useState(false);
  const cookiesFileRef = useRef<HTMLInputElement>(null);

  // Load current settings on mount
  useEffect(() => {
    settingsApi.get().then((s) => {
      setForm((f) => ({
        ...f,
        voyage_api_key: s.voyage_api_key_masked,
        mongodb_uri: s.mongodb_uri_masked,
        mongodb_db: s.mongodb_db,
        mongodb_collection_videos: s.mongodb_collection_videos,
        mongodb_collection_segments: s.mongodb_collection_segments,
        yt_dlp_cookies_browser: s.yt_dlp_cookies_browser,
        yt_dlp_cookies_file: s.yt_dlp_cookies_file,
      }));
    }).catch(() => {});

    settingsApi.indexStatus().then(setIndexStatus).catch(() => {});
    settingsApi.indexCapacity().then(setIndexCapacity).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.save(form);
      toast.success('Settings saved');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await settingsApi.testConnection(form);
      setTestResult(result);
    } catch (e: any) {
      toast.error(e.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleCreateIndexes = async () => {
    setCreatingIndexes(true);
    setIndexLimitHit(false);
    try {
      const result = await settingsApi.createIndexes();

      if (result.limit_reached) {
        setIndexLimitHit(true);
        setCreatingIndexes(false);
        // Refresh capacity so the UI reflects current state
        settingsApi.indexCapacity().then(setIndexCapacity).catch(() => {});
        return;
      }

      if (result.status === 'partial') {
        toast.warning(result.message);
      } else {
        toast.success('Index creation initiated — indexes will be ready in ~1–2 minutes');
      }

      const poll = setInterval(async () => {
        try {
          const status = await settingsApi.indexStatus();
          setIndexStatus(status);
          // Stop when every index is settled (READY or NOT_FOUND — not still BUILDING/PENDING)
          const allSettled =
            status.profiles.every((p) => p.status === 'READY' || p.status === 'NOT_FOUND') &&
            (status.text_index_status === 'READY' || status.text_index_status === 'NOT_FOUND');
          if (allSettled) {
            clearInterval(poll);
            setCreatingIndexes(false);
            const readyCount = status.profiles.filter((p) => p.status === 'READY').length +
              (status.text_index_status === 'READY' ? 1 : 0);
            toast.success(`${readyCount} index${readyCount !== 1 ? 'es' : ''} ready`);
          }
        } catch {}
      }, 5000);
      setTimeout(() => { clearInterval(poll); setCreatingIndexes(false); }, 300_000);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create indexes');
      setCreatingIndexes(false);
    }
  };

  const handleRefreshIndexStatus = async () => {
    try {
      const [status, capacity] = await Promise.all([
        settingsApi.indexStatus(),
        settingsApi.indexCapacity(),
      ]);
      setIndexStatus(status);
      setIndexCapacity(capacity);
    } catch {}
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const result = await settingsApi.backfillDimensions();
      toast.success(result.message);
    } catch (e: any) {
      toast.error(e.message || 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  };

  const handleBackfillThumbs = async () => {
    setBackfillingThumbs(true);
    try {
      const result = await settingsApi.backfillThumbnails();
      toast.success(result.message);
    } catch (e: any) {
      toast.error(e.message || 'Thumbnail backfill failed');
    } finally {
      setBackfillingThumbs(false);
    }
  };

  const handleUploadCookies = async (file: File) => {
    setUploadingCookies(true);
    try {
      const result = await settingsApi.uploadCookies(file);
      setForm((f) => ({ ...f, yt_dlp_cookies_file: result.path }));
      toast.success(`Cookies uploaded (${(result.bytes / 1024).toFixed(1)} KB)`);
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploadingCookies(false);
    }
  };

  const handleDeleteCookies = async () => {
    setDeletingCookies(true);
    try {
      await settingsApi.deleteCookies();
      setForm((f) => ({ ...f, yt_dlp_cookies_file: '' }));
      toast.success('Cookies file deleted');
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    } finally {
      setDeletingCookies(false);
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'READY') return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-xs">READY</Badge>;
    if (status === 'NOT_FOUND') return <Badge variant="outline" className="text-xs">NOT CREATED</Badge>;
    if (status === 'BUILDING' || status === 'PENDING') return <Badge className="bg-amber-500 hover:bg-amber-500 text-xs">BUILDING</Badge>;
    return <Badge variant="destructive" className="text-xs">{status}</Badge>;
  };

  const quantizationBadge = (q: string | null) => {
    if (!q) return <Badge variant="secondary" className="text-xs font-mono">float32</Badge>;
    if (q === 'scalar') return <Badge variant="secondary" className="text-xs font-mono">int8</Badge>;
    if (q === 'binary') return <Badge variant="secondary" className="text-xs font-mono">binary</Badge>;
    return <Badge variant="secondary" className="text-xs font-mono">{q}</Badge>;
  };

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure API keys, database connection, and Atlas indexes.
        </p>
      </div>

      {/* API Keys */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" /> API Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="voyage-key">VoyageAI API Key</Label>
            <div className="relative">
              <Input
                id="voyage-key"
                type={showVoyageKey ? 'text' : 'password'}
                placeholder="pa-..."
                value={form.voyage_api_key}
                onChange={(e) => setForm({ ...form, voyage_api_key: e.target.value })}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowVoyageKey(!showVoyageKey)}
              >
                {showVoyageKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MongoDB */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" /> MongoDB Atlas
          </CardTitle>
          <CardDescription className="text-xs">
            Requires Atlas M0+ cluster for Vector Search and Full-Text Search indexes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mongo-uri">Connection URI</Label>
            <div className="relative">
              <Input
                id="mongo-uri"
                type={showMongoUri ? 'text' : 'password'}
                placeholder="mongodb+srv://user:pass@cluster.mongodb.net/"
                value={form.mongodb_uri}
                onChange={(e) => setForm({ ...form, mongodb_uri: e.target.value })}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowMongoUri(!showMongoUri)}
              >
                {showMongoUri ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mongo-db" className="text-xs">Database</Label>
              <Input
                id="mongo-db"
                value={form.mongodb_db}
                onChange={(e) => setForm({ ...form, mongodb_db: e.target.value })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mongo-col-videos" className="text-xs">Videos Collection</Label>
              <Input
                id="mongo-col-videos"
                value={form.mongodb_collection_videos}
                onChange={(e) => setForm({ ...form, mongodb_collection_videos: e.target.value })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mongo-col-segs" className="text-xs">Segments Collection</Label>
              <Input
                id="mongo-col-segs"
                value={form.mongodb_collection_segments}
                onChange={(e) => setForm({ ...form, mongodb_collection_segments: e.target.value })}
                className="text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* YouTube / yt-dlp */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Play className="h-4 w-4" /> YouTube Downloads
          </CardTitle>
          <CardDescription className="text-xs">
            If YouTube returns a &ldquo;Sign in to confirm you&rsquo;re not a bot&rdquo; error, provide
            authentication cookies. A cookies file takes priority if both are set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Browser */}
          <div className="space-y-1.5">
            <Label htmlFor="cookies-browser" className="text-sm">
              Browser cookies{' '}
              <span className="text-muted-foreground font-normal">(local / non-containerised only)</span>
            </Label>
            <Select
              value={form.yt_dlp_cookies_browser || '__none__'}
              onValueChange={(v) => setForm({ ...form, yt_dlp_cookies_browser: !v || v === '__none__' ? '' : v })}
            >
              <SelectTrigger id="cookies-browser" className="w-48">
                <SelectValue placeholder="Disabled" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Disabled</SelectItem>
                <SelectItem value="chrome">Chrome</SelectItem>
                <SelectItem value="chromium">Chromium</SelectItem>
                <SelectItem value="firefox">Firefox</SelectItem>
                <SelectItem value="edge">Edge</SelectItem>
                <SelectItem value="brave">Brave</SelectItem>
                <SelectItem value="opera">Opera</SelectItem>
                <SelectItem value="vivaldi">Vivaldi</SelectItem>
                <SelectItem value="safari">Safari (macOS)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              yt-dlp reads cookies directly from the selected browser&rsquo;s profile on the server machine.
              Does not work in Docker containers or remote deployments.
            </p>
          </div>

          {/* Cookies file */}
          <div className="space-y-1.5">
            <Label htmlFor="cookies-file" className="text-sm">
              Cookies file path{' '}
              <span className="text-muted-foreground font-normal">(Netscape format)</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="cookies-file"
                placeholder="/path/to/cookies.txt"
                value={form.yt_dlp_cookies_file}
                onChange={(e) => setForm({ ...form, yt_dlp_cookies_file: e.target.value })}
                className="flex-1"
              />
              <input
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                ref={cookiesFileRef}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadCookies(f);
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => cookiesFileRef.current?.click()}
                disabled={uploadingCookies}
              >
                {uploadingCookies
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Upload className="h-4 w-4" />}
                <span className="ml-1.5">Upload</span>
              </Button>
              {form.yt_dlp_cookies_file && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={handleDeleteCookies}
                  disabled={deletingCookies}
                  title="Delete cookies file from server"
                >
                  {deletingCookies
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4" />}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Export from your browser with a cookies.txt extension (e.g.&nbsp;
              <a
                href="https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                yt-dlp cookie guide
              </a>
              ). Use <strong>Upload</strong> to push a local cookies.txt to the server — works for
              remote and Docker deployments.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Settings
        </Button>
        <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
          {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Test Connection
        </Button>
      </div>

      {/* Test results */}
      {testResult && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {testResult.voyage_ok
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <XCircle className="h-4 w-4 text-destructive" />}
              <span>VoyageAI API</span>
              {testResult.voyage_error && (
                <span className="text-xs text-muted-foreground truncate ml-auto max-w-[300px]">
                  {testResult.voyage_error}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              {testResult.mongodb_ok
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <XCircle className="h-4 w-4 text-destructive" />}
              <span>MongoDB Atlas</span>
              {testResult.mongodb_error && (
                <span className="text-xs text-muted-foreground truncate ml-auto max-w-[300px]">
                  {testResult.mongodb_error}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Atlas Indexes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" /> Atlas Search Indexes
          </CardTitle>
          <CardDescription className="text-xs">
            Five vector profiles (Matryoshka dims + quantisation) plus a full-text index. On free/shared
            tiers (M0/M2/M5) indexes are created in priority order so both search types work within the
            3-index quota. The search page adapts automatically to whichever indexes are READY.
            Takes ~1–2 minutes to become READY after creation.
          </CardDescription>
          {indexCapacity && (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs text-muted-foreground">
                {indexCapacity.total_existing} / {indexCapacity.total_needed} indexes on cluster
              </span>
              {indexCapacity.all_present && (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-xs py-0">All present</Badge>
              )}
              {indexCapacity.potentially_at_limit && !indexCapacity.all_present && (
                <Badge variant="destructive" className="text-xs py-0">At tier limit</Badge>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {indexStatus && indexStatus.profiles.length > 0 && (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Profile</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Dims</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Cost</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {indexStatus.profiles.map((p) => (
                    <tr key={p.profile_key} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{p.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.dims}</td>
                      <td className="px-3 py-2">{quantizationBadge(p.quantization)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.cost_note}</td>
                      <td className="px-3 py-2">{statusBadge(p.status)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-3 py-2 text-muted-foreground" colSpan={4}>Full-text search</td>
                    <td className="px-3 py-2">{statusBadge(indexStatus.text_index_status)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {/* Tier limit warning — shown when limit is detected proactively or after a failed attempt */}
          {(indexLimitHit || (indexCapacity?.potentially_at_limit && !indexCapacity?.all_present)) && (
            <div className="rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-900/10 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                    {indexLimitHit ? 'Atlas Search index quota reached' : 'Atlas tier limit detected'}
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    This demo requires <strong>{indexCapacity?.total_needed ?? 6} search indexes</strong> (5 vector
                    profiles + 1 text). Free and shared tiers (M0, M2, M5) allow only{' '}
                    <strong>{indexCapacity?.tier_limit ?? 3} indexes per cluster</strong>.
                    {indexLimitHit
                      ? ` Index creation stopped after ${indexCapacity?.our_indexes_count ?? '?'} of ${indexCapacity?.total_needed ?? 6}.`
                      : ` The cluster currently has ${indexCapacity?.total_existing} index(es) with ${indexCapacity?.missing_indexes.length} still needed.`}
                  </p>
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    The search page automatically shows only the indexes that are available on this cluster.
                    Upgrade to an <strong>M10 or higher</strong> dedicated cluster to unlock all 5 profiles
                    and cross-profile comparison.
                  </p>
                  <a
                    href="https://www.mongodb.com/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                  >
                    View Atlas pricing <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-center">
            <Button
              variant="outline"
              onClick={handleCreateIndexes}
              disabled={creatingIndexes || (indexLimitHit && indexCapacity?.all_present === false)}
              title={indexLimitHit ? 'Cluster has reached the Atlas Search index tier limit' : undefined}
            >
              {creatingIndexes && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create / Recreate Indexes
            </Button>
            <Button
              variant="outline"
              onClick={handleBackfill}
              disabled={backfilling}
              title="Slice 512D and 256D sub-embeddings from stored 1024D vectors — no API calls needed"
            >
              {backfilling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Backfill Dimensions
            </Button>
            <Button
              variant="outline"
              onClick={handleBackfillThumbs}
              disabled={backfillingThumbs}
              title="Generate thumbnail images for existing segments using ffmpeg — no API calls needed"
            >
              {backfillingThumbs && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Backfill Thumbnails
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefreshIndexStatus}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="font-medium">Backfill Dimensions</span> — adds 512D/256D fields to existing segments
              by slicing stored 1024D vectors. No API calls.
            </p>
            <p>
              <span className="font-medium">Backfill Thumbnails</span> — extracts a JPEG frame at the midpoint of
              each segment using ffmpeg. No API calls.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
