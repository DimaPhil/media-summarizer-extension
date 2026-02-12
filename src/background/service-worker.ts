import type {
  Message,
  StartJobRequest,
  SummarizationResult,
  VideoInfo,
  CachedSummary,
  Platform,
  Job,
  ExtensionSettings,
  JobListQuery,
  PromptTemplate,
} from '../shared/types';
import { ErrorCode, SummarizationError, ERROR_MESSAGES } from '../shared/errors';
import { storage } from './storage';
import { GeminiClient, resetGeminiClient } from './gemini-client';
import { fetchVideoCategory } from './youtube-api';
import { getVideoKey, jobStore } from './job-store';

const MAX_SINGLE_REQUEST_VIDEO_SEC = 55 * 60;
const DEFAULT_CHUNK_DURATION_SEC = 12 * 60;
const DEFAULT_CHUNK_OVERLAP_SEC = 8;
const RUNNING_HEARTBEAT_MS = 10 * 1000;
const STALE_JOB_THRESHOLD_MS = 45 * 1000;

let initPromise: Promise<void> | null = null;

function notifyJobUpdated(jobId: string): void {
  chrome.runtime
    .sendMessage({
      type: 'JOB_UPDATED',
      payload: { jobId },
    })
    .catch(() => {});
}

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SummarizationError(ErrorCode.TIMEOUT, errorMessage));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await storage.initialize();
      await jobStore.initialize();

      const migrated = await jobStore.isCacheMigrated();
      if (!migrated) {
        const cachedSummaries = await storage.getAllCachedSummaries();
        await jobStore.migrateCachedSummaries(cachedSummaries);
      }
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  await initPromise;
}

async function getVideoInfoFromTab(tabId: number): Promise<VideoInfo | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_INFO' });
    return response?.payload || null;
  } catch {
    return null;
  }
}

async function getFreshActiveJob(
  videoId: string,
  platform: Platform,
  _timeoutMs: number
): Promise<Job | null> {
  const videoKey = getVideoKey(videoId, platform);
  const activeJob = await jobStore.getActiveJobByVideoKey(videoKey);

  if (!activeJob || activeJob.status !== 'RUNNING') {
    return activeJob;
  }

  const staleThresholdMs = STALE_JOB_THRESHOLD_MS;
  const ageMs = Date.now() - activeJob.updatedAt;

  if (ageMs <= staleThresholdMs) {
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
  streamResponse: boolean
): Promise<string> {
  if (streamResponse) {
    const runStreaming = async (): Promise<string> => {
      let fullText = '';
      const stream = client.summarizeYouTubeVideoStream(request.videoInfo, promptText);

      for await (const chunk of stream) {
        fullText += chunk;
        await jobStore.appendJobOutput(job.jobId, chunk);
        notifyJobUpdated(job.jobId);

        chrome.runtime
          .sendMessage({
            type: 'SUMMARIZE_STREAM',
            payload: { chunk, done: false, jobId: job.jobId },
          })
          .catch(() => {});
      }

      chrome.runtime
        .sendMessage({
          type: 'SUMMARIZE_STREAM',
          payload: { chunk: '', done: true, jobId: job.jobId },
        })
        .catch(() => {});

      return fullText;
    };

    return withTimeout(
      runStreaming(),
      timeoutMs,
      `Summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`
    );
  }

  const fullText = await withTimeout(
    client.summarizeYouTubeVideo(request.videoInfo, promptText),
    timeoutMs,
    `Summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`
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
  timeoutMs: number
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
    const summarizeSegment = async () => {
      let segmentText = '';
      const stream = client.summarizeYouTubeVideoStream(request.videoInfo, promptText, {
        startSec: segment.startSec,
        endSec: segment.endSec,
      });

      for await (const chunk of stream) {
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
      `Segment summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`
    );

    completedSegments.push({
      index: segment.index,
      startSec: segment.startSec,
      endSec: segment.endSec,
      outputText,
    });

    notifyJobUpdated(job.jobId);
  }

  let mergeOutputText = '';

  try {
    mergeOutputText = await withTimeout(
      client.mergeSegmentOutputs(promptText, completedSegments),
      timeoutMs,
      `Merge step timed out after ${Math.round(timeoutMs / 60000)} minutes`
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
) {
  const initialJob = await jobStore.getJob(jobId);
  if (!initialJob || initialJob.status !== 'RUNNING') {
    return;
  }

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
        timeoutMs
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
          settings.streamResponse
        );
      } catch (error) {
        if (durationSec && isDurationOrContextError(error)) {
          const chunked = await runChunkedRequest(
            initialJob,
            request,
            prompt.prompt,
            client,
            durationSec,
            timeoutMs
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

    chrome.runtime
      .sendMessage({
        type: 'SUMMARIZE_RESPONSE',
        payload: {
          success: true,
          summary: outputText,
          cached: false,
          jobId,
          status: 'SUCCEEDED',
        } satisfies SummarizationResult,
      })
      .catch(() => {});
  } catch (error) {
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

    chrome.runtime
      .sendMessage({
        type: 'SUMMARIZE_RESPONSE',
        payload: {
          success: false,
          error: summError.message,
          jobId,
          status: 'FAILED',
        } satisfies SummarizationResult,
      })
      .catch(() => {});
  } finally {
    stopHeartbeat();
  }
}

async function startJob(request: StartJobRequest): Promise<SummarizationResult> {
  await ensureInitialized();

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
  const timeoutMs = (settings.summarizationTimeoutMinutes || 5) * 60 * 1000;
  const activeJob = await getFreshActiveJob(videoInfo.videoId, videoInfo.platform, timeoutMs);

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

async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new GeminiClient(apiKey);
    return await client.testConnection();
  } catch {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  console.debug('[Media Summarizer] Extension installed and initialized');
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureInitialized();
});

chrome.runtime.onMessage.addListener(
  (message: Message | { type: string; payload?: unknown }, _sender, sendResponse) => {
    const handleMessage = async () => {
      await ensureInitialized();

      switch (message.type) {
        case 'GET_VIDEO_INFO': {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            const videoInfo = await getVideoInfoFromTab(tabs[0].id);
            if (videoInfo && videoInfo.platform === 'youtube') {
              const settings = await storage.getSettings();
              if (settings.youtubeApiKey) {
                const categoryData = await fetchVideoCategory(
                  videoInfo.videoId,
                  settings.youtubeApiKey
                );
                if (categoryData) {
                  videoInfo.categoryId = categoryData.categoryId;
                  videoInfo.categoryName = categoryData.categoryName;
                  videoInfo.title = categoryData.title || videoInfo.title;
                }
              }
            }
            return { type: 'VIDEO_INFO_RESPONSE', payload: videoInfo };
          }
          return { type: 'VIDEO_INFO_RESPONSE', payload: null };
        }

        case 'SUMMARIZE':
        case 'START_JOB': {
          const request = message.payload as StartJobRequest;
          const result = await startJob(request);
          return { type: 'SUMMARIZE_RESPONSE', payload: result };
        }

        case 'GET_SETTINGS': {
          const settings = await storage.getSettings();
          return { type: 'SETTINGS_RESPONSE', payload: settings };
        }

        case 'SAVE_SETTINGS': {
          const settings = message.payload as ExtensionSettings;
          await storage.saveSettings(settings);
          return { type: 'SETTINGS_RESPONSE', payload: settings };
        }

        case 'GET_PROMPTS': {
          const prompts = await storage.getPrompts();
          return { type: 'PROMPTS_RESPONSE', payload: prompts };
        }

        case 'SAVE_PROMPTS': {
          const prompts = message.payload as PromptTemplate[];
          await storage.savePrompts(prompts);
          return { type: 'PROMPTS_RESPONSE', payload: prompts };
        }

        case 'RESET_DEFAULTS': {
          await storage.resetToDefaults();
          const allData = await storage.getAllData();
          return { type: 'SETTINGS_RESPONSE', payload: allData };
        }

        case 'TEST_API_KEY': {
          const apiKey = message.payload as string;
          const isValid = await testApiKey(apiKey);
          return { type: 'API_KEY_TEST_RESULT', payload: isValid };
        }

        case 'GET_CACHED_SUMMARY': {
          const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
          const cached = await storage.getCachedSummary(videoId, platform);
          return { type: 'CACHED_SUMMARY_RESPONSE', payload: cached };
        }

        case 'CLEAR_CACHED_SUMMARY': {
          const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
          await storage.clearCachedSummary(videoId, platform);
          return { type: 'CACHED_SUMMARY_RESPONSE', payload: null };
        }

        case 'GET_ALL_CACHED_SUMMARIES': {
          const summaries = await storage.getAllCachedSummaries();
          return { type: 'CACHED_SUMMARY_RESPONSE', payload: summaries };
        }

        case 'CHECK_IN_PROGRESS': {
          const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
          const timeoutMs = (await storage.getSettings()).summarizationTimeoutMinutes * 60 * 1000;
          const activeJob = await getFreshActiveJob(videoId, platform, timeoutMs);
          return {
            type: 'IN_PROGRESS_RESPONSE',
            payload: {
              inProgress: Boolean(activeJob && activeJob.status === 'RUNNING'),
              startTime: activeJob?.startedAt,
              promptId: activeJob?.promptId,
              jobId: activeJob?.jobId,
            },
          };
        }

        case 'GET_ACTIVE_JOB': {
          const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
          const timeoutMs = (await storage.getSettings()).summarizationTimeoutMinutes * 60 * 1000;
          const activeJob = await getFreshActiveJob(videoId, platform, timeoutMs);
          return { type: 'ACTIVE_JOB_RESPONSE', payload: activeJob };
        }

        case 'GET_JOB': {
          const { jobId } = message.payload as { jobId: string };
          const job = await jobStore.getJob(jobId);
          return { type: 'JOB_RESPONSE', payload: job };
        }

        case 'LIST_JOBS': {
          const query = (message.payload || {}) as JobListQuery;
          const jobs = await jobStore.listJobs(query);
          return { type: 'LIST_JOBS_RESPONSE', payload: jobs };
        }

        case 'UPDATE_JOB_EDITED_TEXT': {
          const payload = message.payload as { jobId: string; editedText: string };
          const job = await jobStore.updateEditedText(payload.jobId, payload.editedText);
          if (job) {
            notifyJobUpdated(job.jobId);
          }
          return { type: 'JOB_RESPONSE', payload: job };
        }

        case 'DELETE_JOB': {
          const payload = message.payload as { jobId: string };
          const deleted = await jobStore.deleteJob(payload.jobId);
          return { type: 'JOB_RESPONSE', payload: { deleted } };
        }

        case 'CLEAR_ALL_JOBS': {
          await jobStore.clearAllJobs();
          return { type: 'JOB_RESPONSE', payload: { success: true } };
        }

        default:
          return null;
      }
    };

    handleMessage()
      .then(sendResponse)
      .catch((error) => {
        console.error('[Media Summarizer] Message handler error:', error);
        sendResponse({ error: String(error) });
      });

    return true;
  }
);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    resetGeminiClient();
  }
});
