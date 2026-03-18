import type {
  CachedSummary,
  ExtensionSettings,
  Job,
  Platform,
  PromptTemplate,
  StartJobRequest,
  SummarizationResult,
} from '../shared/types';
import { ErrorCode, SummarizationError, ERROR_MESSAGES } from '../shared/errors';
import { GeminiClient } from './gemini-client';
import { storage } from './storage';
import { getVideoKey, jobStore } from './job-store';
import {
  emitSummarizeResponse,
  emitSummarizeStream,
  notifyJobUpdated,
} from './background-notifications';

const MAX_SINGLE_REQUEST_VIDEO_SEC = 55 * 60;
const DEFAULT_CHUNK_DURATION_SEC = 12 * 60;
const DEFAULT_CHUNK_OVERLAP_SEC = 8;
const RUNNING_HEARTBEAT_MS = 10 * 1000;
const STALE_JOB_THRESHOLD_MS = 45 * 1000;

const runningControllers = new Map<string, AbortController>();

function isDurationOrContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes('too long') ||
    lowered.includes('maximum') ||
    lowered.includes('context') ||
    lowered.includes('token') ||
    lowered.includes('size') ||
    lowered.includes('input')
  );
}

function parseDurationToSeconds(duration?: string): number | null {
  if (!duration) {
    return null;
  }

  const raw = duration.trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split(':').map((part) => parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return null;
}

function createSegments(durationSec: number, chunkSec: number, overlapSec: number) {
  const segments: Array<{ index: number; startSec: number; endSec: number }> = [];

  let startSec = 0;
  let index = 0;

  while (startSec < durationSec) {
    const endSec = Math.min(startSec + chunkSec, durationSec);
    segments.push({
      index,
      startSec,
      endSec,
    });

    if (endSec >= durationSec) {
      break;
    }

    const nextStart = Math.max(endSec - overlapSec, startSec + 1);
    startSec = nextStart;
    index += 1;
  }

  return segments;
}

function mergeSegmentOutputsFallback(segmentOutputs: string[]): string {
  if (segmentOutputs.length === 0) {
    return '';
  }

  const normalized = segmentOutputs.map((part) => part.trim()).filter(Boolean);
  if (normalized.length <= 1) {
    return normalized[0] || '';
  }

  let merged = normalized[0];

  for (let i = 1; i < normalized.length; i += 1) {
    const next = normalized[i];
    const currentTail = merged.slice(-500);
    const nextHead = next.slice(0, 500);

    let overlap = 0;
    const maxOverlap = Math.min(currentTail.length, nextHead.length);

    for (let size = maxOverlap; size >= 25; size -= 1) {
      const tail = currentTail.slice(currentTail.length - size).toLowerCase();
      const head = nextHead.slice(0, size).toLowerCase();
      if (tail === head) {
        overlap = size;
        break;
      }
    }

    merged += overlap > 0 ? next.slice(overlap) : `\n\n${next}`;
  }

  return merged;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      reject(new SummarizationError(ErrorCode.TIMEOUT, errorMessage));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    promise
      .then((result) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
  });
}

export async function getFreshActiveJob(videoId: string, platform: Platform): Promise<Job | null> {
  const videoKey = getVideoKey(videoId, platform);
  const activeJob = await jobStore.getActiveJobByVideoKey(videoKey);

  if (!activeJob || activeJob.status !== 'RUNNING') {
    return activeJob;
  }

  const ageMs = Date.now() - activeJob.updatedAt;
  if (ageMs <= STALE_JOB_THRESHOLD_MS) {
    return activeJob;
  }

  await jobStore.completeJob(activeJob.jobId, {
    status: 'FAILED',
    errorMessage: 'Previous job lock expired. The extension worker was likely restarted.',
  });
  notifyJobUpdated(activeJob.jobId);
  return null;
}

function startRunningHeartbeat(jobId: string): () => void {
  const timer = setInterval(() => {
    void jobStore
      .updateJob(jobId, {})
      .then((job) => {
        if (job && job.status === 'RUNNING') {
          notifyJobUpdated(jobId);
        }
      })
      .catch(() => {});
  }, RUNNING_HEARTBEAT_MS);

  return () => clearInterval(timer);
}

async function runSingleRequest(
  job: Job,
  request: StartJobRequest,
  promptText: string,
  client: GeminiClient,
  timeoutMs: number,
  streamResponse: boolean,
  signal?: AbortSignal
): Promise<string> {
  if (streamResponse) {
    const runStreaming = async (): Promise<string> => {
      let fullText = '';
      const stream = client.summarizeYouTubeVideoStream(request.videoInfo, promptText);

      for await (const chunk of stream) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        fullText += chunk;
        await jobStore.appendJobOutput(job.jobId, chunk);
        notifyJobUpdated(job.jobId);
        emitSummarizeStream(job.jobId, chunk, false);
      }

      emitSummarizeStream(job.jobId, '', true);
      return fullText;
    };

    return withTimeout(
      runStreaming(),
      timeoutMs,
      `Summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`,
      signal
    );
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const fullText = await withTimeout(
    client.summarizeYouTubeVideo(request.videoInfo, promptText),
    timeoutMs,
    `Summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`,
    signal
  );

  await jobStore.updateJob(job.jobId, { outputText: fullText });
  notifyJobUpdated(job.jobId);
  return fullText;
}

async function runChunkedRequest(
  job: Job,
  request: StartJobRequest,
  promptText: string,
  client: GeminiClient,
  durationSec: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ outputText: string; segments: Job['segments']; mergeOutputText?: string }> {
  const segments = createSegments(
    durationSec,
    DEFAULT_CHUNK_DURATION_SEC,
    DEFAULT_CHUNK_OVERLAP_SEC
  );
  const completedSegments: NonNullable<Job['segments']> = [];

  await jobStore.updateJob(job.jobId, {
    outputText: '',
    segments: [],
    modelSnapshot: {
      ...job.modelSnapshot,
      chunkingUsed: true,
      chunkDurationSec: DEFAULT_CHUNK_DURATION_SEC,
      chunkOverlapSec: DEFAULT_CHUNK_OVERLAP_SEC,
    },
  });
  notifyJobUpdated(job.jobId);

  for (const segment of segments) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const summarizeSegment = async () => {
      let segmentText = '';
      const stream = client.summarizeYouTubeVideoStream(request.videoInfo, promptText, {
        startSec: segment.startSec,
        endSec: segment.endSec,
      });

      for await (const chunk of stream) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        segmentText += chunk;
        await jobStore.appendJobOutput(job.jobId, chunk, {
          index: segment.index,
          startSec: segment.startSec,
          endSec: segment.endSec,
        });
        notifyJobUpdated(job.jobId);
      }

      return segmentText;
    };

    const outputText = await withTimeout(
      summarizeSegment(),
      timeoutMs,
      `Segment summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`,
      signal
    );

    completedSegments.push({
      index: segment.index,
      startSec: segment.startSec,
      endSec: segment.endSec,
      outputText,
    });

    notifyJobUpdated(job.jobId);
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let mergeOutputText = '';

  try {
    mergeOutputText = await withTimeout(
      client.mergeSegmentOutputs(promptText, completedSegments),
      timeoutMs,
      `Merge step timed out after ${Math.round(timeoutMs / 60000)} minutes`,
      signal
    );
  } catch {
    mergeOutputText = mergeSegmentOutputsFallback(
      completedSegments.map((segment) => segment.outputText)
    );
  }

  return {
    outputText: mergeOutputText,
    segments: completedSegments,
    mergeOutputText,
  };
}

async function runJob(
  jobId: string,
  request: StartJobRequest,
  prompt: PromptTemplate,
  settings: ExtensionSettings
): Promise<void> {
  const initialJob = await jobStore.getJob(jobId);
  if (!initialJob || initialJob.status !== 'RUNNING') {
    return;
  }

  const controller = new AbortController();
  runningControllers.set(jobId, controller);
  const { signal } = controller;

  const stopHeartbeat = startRunningHeartbeat(jobId);
  const timeoutMs = (settings.summarizationTimeoutMinutes || 5) * 60 * 1000;

  try {
    const client = new GeminiClient(settings.geminiApiKey, settings.geminiModel);

    if (request.videoInfo.platform !== 'youtube') {
      throw new SummarizationError(ErrorCode.UNSUPPORTED_PLATFORM);
    }

    const durationSec = parseDurationToSeconds(request.videoInfo.duration);
    const shouldChunkBeforeStart = Boolean(
      durationSec && durationSec > MAX_SINGLE_REQUEST_VIDEO_SEC
    );

    let outputText = '';
    let segments: Job['segments'];
    let mergeOutputText: string | undefined;

    if (shouldChunkBeforeStart && durationSec) {
      const chunked = await runChunkedRequest(
        initialJob,
        request,
        prompt.prompt,
        client,
        durationSec,
        timeoutMs,
        signal
      );
      outputText = chunked.outputText;
      segments = chunked.segments;
      mergeOutputText = chunked.mergeOutputText;
    } else {
      try {
        outputText = await runSingleRequest(
          initialJob,
          request,
          prompt.prompt,
          client,
          timeoutMs,
          settings.streamResponse,
          signal
        );
      } catch (error) {
        if (signal.aborted) throw error;
        if (durationSec && isDurationOrContextError(error)) {
          const chunked = await runChunkedRequest(
            initialJob,
            request,
            prompt.prompt,
            client,
            durationSec,
            timeoutMs,
            signal
          );
          outputText = chunked.outputText;
          segments = chunked.segments;
          mergeOutputText = chunked.mergeOutputText;
        } else {
          throw error;
        }
      }
    }

    const finalJob = await jobStore.completeJob(jobId, {
      status: 'SUCCEEDED',
      outputText,
      segments,
      mergeOutputText,
    });

    const cachedSummary: CachedSummary = {
      videoId: request.videoInfo.videoId,
      platform: request.videoInfo.platform,
      videoTitle: request.videoInfo.title,
      videoUrl: request.videoInfo.url,
      promptId: request.promptId,
      promptName: prompt.name,
      summary: outputText,
      timestamp: Date.now(),
    };
    await storage.saveCachedSummary(cachedSummary);

    if (finalJob) {
      notifyJobUpdated(finalJob.jobId);
    }

    emitSummarizeResponse({
      success: true,
      summary: outputText,
      cached: false,
      jobId,
      status: 'SUCCEEDED',
    });
  } catch (error) {
    if (signal.aborted) {
      const canceledJob = await jobStore.completeJob(jobId, { status: 'CANCELED' });
      if (canceledJob) notifyJobUpdated(canceledJob.jobId);
      return;
    }

    const summError =
      error instanceof SummarizationError
        ? error
        : new SummarizationError(ErrorCode.UNKNOWN_ERROR, String(error));

    const failedJob = await jobStore.completeJob(jobId, {
      status: 'FAILED',
      errorMessage: summError.message,
    });

    if (failedJob) {
      notifyJobUpdated(failedJob.jobId);
    }

    emitSummarizeResponse({
      success: false,
      error: summError.message,
      jobId,
      status: 'FAILED',
    });
  } finally {
    runningControllers.delete(jobId);
    stopHeartbeat();
  }
}

export async function startJob(request: StartJobRequest): Promise<SummarizationResult> {
  const settings = await storage.getSettings();

  if (!settings.geminiApiKey) {
    return {
      success: false,
      error: ERROR_MESSAGES[ErrorCode.NO_API_KEY],
    };
  }

  const prompt = await storage.getPromptById(request.promptId);
  if (!prompt) {
    return {
      success: false,
      error: 'Selected prompt not found',
    };
  }

  const { videoInfo } = request;
  const activeJob = await getFreshActiveJob(videoInfo.videoId, videoInfo.platform);

  if (activeJob && activeJob.status === 'RUNNING') {
    return {
      success: false,
      inProgress: true,
      error: 'Summarization already in progress for this video',
      jobId: activeJob.jobId,
      status: activeJob.status,
    };
  }

  if (!request.forceRegenerate) {
    const cached = await storage.getCachedSummary(videoInfo.videoId, videoInfo.platform);
    if (cached && cached.promptId === request.promptId) {
      return {
        success: true,
        summary: cached.summary,
        cached: true,
      };
    }
  }

  const created = await jobStore.createRunningJob({
    videoKey: getVideoKey(videoInfo.videoId, videoInfo.platform),
    platform: videoInfo.platform,
    videoId: videoInfo.videoId,
    videoUrl: videoInfo.url,
    videoTitle: videoInfo.title,
    thumbnailUrl:
      videoInfo.platform === 'youtube'
        ? `https://i.ytimg.com/vi/${videoInfo.videoId}/hqdefault.jpg`
        : undefined,
    categoryId: videoInfo.categoryId,
    categoryName: videoInfo.categoryName,
    channelId: videoInfo.channelId,
    channelTitle: videoInfo.channelTitle,
    promptId: prompt.id,
    promptName: prompt.name,
    promptTextSnapshot: prompt.prompt,
    modelSnapshot: {
      model: settings.geminiModel,
      streamResponse: settings.streamResponse,
      summarizationTimeoutMinutes: settings.summarizationTimeoutMinutes,
      chunkingUsed: false,
    },
    outputText: '',
    editedText: '',
    segments: [],
  });

  if (!created.created) {
    return {
      success: false,
      inProgress: true,
      error: 'Summarization already in progress for this video',
      jobId: created.job.jobId,
      status: created.job.status,
    };
  }

  notifyJobUpdated(created.job.jobId);
  void runJob(created.job.jobId, request, prompt, settings);

  return {
    success: true,
    inProgress: true,
    summary: '',
    cached: false,
    jobId: created.job.jobId,
    status: created.job.status,
  };
}

export async function cancelRunningJob(jobId: string): Promise<void> {
  const controller = runningControllers.get(jobId);
  if (controller) {
    controller.abort();
    return;
  }

  const job = await jobStore.getJob(jobId);
  if (job && job.status === 'RUNNING') {
    await jobStore.completeJob(jobId, { status: 'CANCELED' });
    notifyJobUpdated(jobId);
  }
}

export async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new GeminiClient(apiKey);
    return await client.testConnection();
  } catch {
    return false;
  }
}
