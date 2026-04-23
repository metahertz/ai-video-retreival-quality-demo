'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { adsApi } from '@/lib/api';
import type { AdResponse, EmotionTag } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const EMOTION_OPTIONS: { tag: EmotionTag; label: string; color: string }[] = [
  { tag: 'positive', label: 'Positive', color: 'emerald' },
  { tag: 'neutral',  label: 'Neutral',  color: 'blue' },
  { tag: 'intense',  label: 'Intense',  color: 'amber' },
  { tag: 'negative', label: 'Negative', color: 'red' },
];

const EMOTION_ACTIVE_CLASS: Record<string, string> = {
  emerald: 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700',
  blue:    'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
  amber:   'bg-amber-500 text-white border-amber-500 hover:bg-amber-600',
  red:     'bg-red-600 text-white border-red-600 hover:bg-red-700',
};

interface AdFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: (ad: AdResponse) => void;
  initial?: AdResponse | null;
}

export default function AdFormDialog({ open, onClose, onSaved, initial }: AdFormDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(10);
  const [emotionTags, setEmotionTags] = useState<EmotionTag[]>(['positive', 'neutral', 'intense']);
  const [saving, setSaving] = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (initial) {
      setTitle(initial.title);
      setDescription(initial.description);
      setDuration(initial.duration_seconds);
      setEmotionTags(initial.emotion_tags as EmotionTag[]);
    } else {
      setTitle('');
      setDescription('');
      setDuration(10);
      setEmotionTags(['positive', 'neutral', 'intense']);
    }
  }, [initial, open]);

  const toggleTag = (tag: EmotionTag) => {
    setEmotionTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!description.trim()) { toast.error('Description is required'); return; }
    if (emotionTags.length === 0) { toast.error('Select at least one compatible emotion'); return; }

    setSaving(true);
    try {
      const body = { title: title.trim(), description: description.trim(), duration_seconds: duration, emotion_tags: emotionTags };
      const result = initial
        ? await adsApi.update(initial.id, body)
        : await adsApi.create(body);
      onSaved(result);
      toast.success(initial ? 'Ad updated' : 'Ad created');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save ad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Ad' : 'Create New Ad'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="ad-title">Title</Label>
            <Input
              id="ad-title"
              placeholder="e.g. Summer Sale, Truck Brand…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ad-desc">
              Ad text{' '}
              <span className="text-muted-foreground font-normal">(shown as overlay)</span>
            </Label>
            <textarea
              id="ad-desc"
              placeholder="Write the ad copy that will be displayed over the video segment…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm min-h-[100px] resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              This text is also embedded to find matching video segments.
            </p>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label className="text-sm">
              Display duration: <span className="font-semibold">{duration}s</span>
            </Label>
            <Slider
              min={1} max={30} step={1}
              value={[duration]}
              onValueChange={(v) => setDuration(Array.isArray(v) ? v[0] : (v as number))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1s</span><span>30s</span>
            </div>
          </div>

          {/* Emotion compatibility */}
          <div className="space-y-2">
            <Label className="text-sm">
              Compatible with content emotions
              <span className="ml-1 text-xs text-muted-foreground font-normal">(select all that apply)</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {EMOTION_OPTIONS.map(({ tag, label, color }) => {
                const active = emotionTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? EMOTION_ACTIVE_CLASS[color]
                        : 'bg-background text-muted-foreground border-border hover:border-foreground/30'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Ads will only be suggested for video segments whose content emotion matches one of these.
              Unscored videos show a neutral indicator.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initial ? 'Save Changes' : 'Create Ad'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
