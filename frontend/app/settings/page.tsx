'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { settingsApi } from '@/lib/api';
import type { SettingsRequest, ConnectionTestResult, AllIndexStatusResponse } from '@/lib/types';
import {
  Eye, EyeOff, Loader2, CheckCircle2, XCircle, RefreshCw,
  Database, Key, Layers
} from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const [form, setForm] = useState<SettingsRequest>({
    voyage_api_key: '',
    mongodb_uri: '',
    mongodb_db: 'voyage_video_demo',
    mongodb_collection_videos: 'videos',
    mongodb_collection_segments: 'video_segments',
  });
  const [showVoyageKey, setShowVoyageKey] = useState(false);
  const [showMongoUri, setShowMongoUri] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [creatingIndexes, setCreatingIndexes] = useState(false);
  const [indexStatus, setIndexStatus] = useState<AllIndexStatusResponse | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillingThumbs, setBackfillingThumbs] = useState(false);

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
      }));
    }).catch(() => {});

    settingsApi.indexStatus().then(setIndexStatus).catch(() => {});
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
    try {
      await settingsApi.createIndexes();
      toast.success('Index creation initiated — indexes will be ready in ~1–2 minutes');
      const poll = setInterval(async () => {
        try {
          const status = await settingsApi.indexStatus();
          setIndexStatus(status);
          const allReady = status.profiles.every((p) => p.status === 'READY') &&
            status.text_index_status === 'READY';
          if (allReady) {
            clearInterval(poll);
            setCreatingIndexes(false);
            toast.success('All indexes are READY');
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
      const status = await settingsApi.indexStatus();
      setIndexStatus(status);
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
            Five vector profiles (Matryoshka dims + quantisation) plus a full-text index.
            Takes ~1–2 minutes to become READY after creation.
          </CardDescription>
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
          <div className="flex gap-2 flex-wrap items-center">
            <Button
              variant="outline"
              onClick={handleCreateIndexes}
              disabled={creatingIndexes}
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
