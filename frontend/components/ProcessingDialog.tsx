'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { processApi } from '@/lib/api';
import type { VideoResponse, ProcessJobStatus } from '@/lib/types';
import { Loader2, CheckCircle2, XCircle, Info, StopCircle, Ban } from 'lucide-react';

interface ProcessingDialogProps {
  video: VideoResponse | null;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialJob?: ProcessJobStatus | null;
}

const STRATEGIES = [
  {
    value: 'whole',
    label: 'Whole video',
    description: 'Embed the entire video as one chunk. VoyageAI auto-optimises frame sampling.',
  },
  {
    value: 'caption',
    label: 'Caption-based',
    description: 'Split at YouTube caption timestamps. Best semantic alignment. Requires English captions.',
  },
  {
    value: 'scene',
    label: 'Scene detection',
    description: 'Split at major visual cuts detected by ffmpeg. Good for content with clear scene changes.',
  },
  {
    value: 'fixed',
    label: 'Fixed interval',
    description: 'Split every N seconds. Simple and predictable. Adjust interval below.',
  },
] as const;

type Strategy = (typeof STRATEGIES)[number]['value'];

export function ProcessingDialog({ video, open, onClose, onComplete, initialJob }: ProcessingDialogProps) {
  const [strategy, setStrategy] = useState<Strategy>('caption');
  const [intervalSecs, setIntervalSecs] = useState(30);
  const [job, setJob] = useState<ProcessJobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset when dialog opens; pre-load job if provided
  useEffect(() => {
    if (open) {
      setJob(initialJob ?? null);
      setStarting(false);
      setStopping(false);
    }
  }, [open, video?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll job status
  useEffect(() => {
    if (job && (job.status === 'pending' || job.status === 'processing')) {
      pollRef.current = setInterval(async () => {
        try {
          const updated = await processApi.getStatus(job.job_id);
          setJob(updated);
          if (updated.status === 'completed' || updated.status === 'error' || updated.status === 'cancelled') {
            clearInterval(pollRef.current!);
            if (updated.status === 'completed') {
              onComplete();
            }
          }
        } catch {}
      }, 2000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job?.job_id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    if (!video) return;
    setStarting(true);
    try {
      const newJob = await processApi.start({
        video_id: video.id,
        chunking_strategy: strategy,
        interval_seconds: strategy === 'fixed' ? intervalSecs : undefined,
      });
      setJob(newJob);
    } catch (e: any) {
      setJob({
        job_id: '',
        video_id: video?.id ?? '',
        status: 'error',
        progress: 0,
        message: e.message || 'Failed to start processing',
        segments_processed: 0,
        total_segments: 0,
      });
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!job?.job_id) return;
    setStopping(true);
    try {
      await processApi.cancelJob(job.job_id);
      // Next poll will pick up the cancelled status
    } catch {}
    finally {
      setStopping(false);
    }
  };

  const isRunning = job?.status === 'pending' || job?.status === 'processing';
  const isDone = job?.status === 'completed';
  const isError = job?.status === 'error';
  const isCancelled = job?.status === 'cancelled';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Process Video</DialogTitle>
          {video && (
            <p className="text-sm text-muted-foreground line-clamp-1 mt-1">{video.title}</p>
          )}
        </DialogHeader>

        {!job && (
          <div className="space-y-5 py-2">
            <RadioGroup
              value={strategy}
              onValueChange={(v) => setStrategy(v as Strategy)}
              className="space-y-3"
            >
              {STRATEGIES.map((s) => (
                <div
                  key={s.value}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                    strategy === s.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setStrategy(s.value)}
                >
                  <RadioGroupItem value={s.value} id={s.value} className="mt-0.5" />
                  <Label htmlFor={s.value} className="cursor-pointer space-y-0.5">
                    <span className="font-medium text-sm">{s.label}</span>
                    <p className="text-xs text-muted-foreground font-normal leading-relaxed">
                      {s.description}
                    </p>
                  </Label>
                </div>
              ))}
            </RadioGroup>

            {strategy === 'fixed' && (
              <div className="space-y-2 px-1">
                <Label className="text-sm">Interval: {intervalSecs}s</Label>
                <Slider
                  min={5}
                  max={120}
                  step={5}
                  value={[intervalSecs]}
                  onValueChange={(v) => setIntervalSecs(Array.isArray(v) ? v[0] : (v as number))}
                />
                <p className="text-xs text-muted-foreground">
                  Video will be split into ~{Math.ceil((video?.duration || 60) / intervalSecs)} segments
                </p>
              </div>
            )}
          </div>
        )}

        {/* Job progress */}
        {job && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              {isRunning   && <Loader2    className="h-4 w-4 animate-spin text-primary" />}
              {isDone      && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              {isError     && <XCircle    className="h-4 w-4 text-destructive" />}
              {isCancelled && <Ban        className="h-4 w-4 text-muted-foreground" />}
              <span className="text-sm font-medium capitalize">{job.status}</span>
            </div>

            {(isRunning || isDone) && (
              <Progress value={job.progress * 100} className="h-2" />
            )}

            <p className="text-sm text-muted-foreground">{job.message}</p>

            {job.segments_processed > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {job.segments_processed}
                  {job.total_segments > 0 ? `/${job.total_segments}` : ''} segments embedded
                </Badge>
              </div>
            )}

            {isError && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{job.message}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!job && (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleStart} disabled={starting}>
                {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start Processing
              </Button>
            </>
          )}
          {isRunning && (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button variant="destructive" onClick={handleStop} disabled={stopping}>
                {stopping
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <StopCircle className="mr-2 h-4 w-4" />}
                Stop
              </Button>
            </>
          )}
          {(isDone || isError || isCancelled) && (
            <Button onClick={onClose}>{isDone ? 'Done' : 'Close'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
