import type {
  Message,
  SummarizationRequest,
  SummarizationResult,
  VideoInfo,
  CachedSummary,
  Platform,
} from '../shared/types';
import { CATEGORY_TO_PROMPT } from '../shared/constants';
import { ErrorCode, SummarizationError, ERROR_MESSAGES } from '../shared/errors';
import { storage } from './storage';
import { GeminiClient, resetGeminiClient } from './gemini-client';
import { fetchVideoCategory } from './youtube-api';

// Track in-flight summarization requests by video key (platform:videoId)
const inFlightRequests = new Map<string, { startTime: number; promptId: string }>();

function getVideoKey(videoId: string, platform: Platform): string {
  return `${platform}:${videoId}`;
}

function isVideoInProgress(videoId: string, platform: Platform): boolean {
  return inFlightRequests.has(getVideoKey(videoId, platform));
}

function markVideoInProgress(videoId: string, platform: Platform, promptId: string): void {
  inFlightRequests.set(getVideoKey(videoId, platform), {
    startTime: Date.now(),
    promptId,
  });
}

function markVideoComplete(videoId: string, platform: Platform): void {
  inFlightRequests.delete(getVideoKey(videoId, platform));
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

chrome.runtime.onInstalled.addListener(async () => {
  await storage.initialize();
  console.log('[Media Summarizer] Extension installed and initialized');
});

async function getVideoInfoFromTab(tabId: number): Promise<VideoInfo | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_INFO' });
    return response?.payload || null;
  } catch {
    return null;
  }
}

async function summarizeVideo(
  request: SummarizationRequest & { forceRegenerate?: boolean },
  timeoutMs: number,
  sendStreamChunk?: (chunk: string, done: boolean) => void
): Promise<SummarizationResult> {
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

  try {
    const client = new GeminiClient(settings.geminiApiKey, settings.geminiModel);

    if (request.videoInfo.platform !== 'youtube') {
      return {
        success: false,
        error: ERROR_MESSAGES[ErrorCode.UNSUPPORTED_PLATFORM],
      };
    }

    let summary: string;

    if (settings.streamResponse && sendStreamChunk) {
      // For streaming, we wrap the entire streaming process with timeout
      const streamWithTimeout = async (): Promise<string> => {
        let fullText = '';
        const stream = client.summarizeYouTubeVideoStream(request.videoInfo, prompt.prompt);

        for await (const chunk of stream) {
          fullText += chunk;
          sendStreamChunk(chunk, false);
        }

        sendStreamChunk('', true);
        return fullText;
      };

      summary = await withTimeout(
        streamWithTimeout(),
        timeoutMs,
        `Summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`
      );
    } else {
      summary = await withTimeout(
        client.summarizeYouTubeVideo(request.videoInfo, prompt.prompt),
        timeoutMs,
        `Summarization timed out after ${Math.round(timeoutMs / 60000)} minutes`
      );
    }

    // Save to cache
    const cachedSummary: CachedSummary = {
      videoId: request.videoInfo.videoId,
      platform: request.videoInfo.platform,
      videoTitle: request.videoInfo.title,
      videoUrl: request.videoInfo.url,
      promptId: request.promptId,
      promptName: prompt.name,
      summary,
      timestamp: Date.now(),
    };
    await storage.saveCachedSummary(cachedSummary);

    return {
      success: true,
      summary,
      cached: false,
    };
  } catch (error) {
    const summError = error instanceof SummarizationError
      ? error
      : new SummarizationError(ErrorCode.UNKNOWN_ERROR, String(error));

    return {
      success: false,
      error: summError.message,
    };
  }
}

async function testApiKey(apiKey: string): Promise<boolean> {
  try {
    const client = new GeminiClient(apiKey);
    return await client.testConnection();
  } catch {
    return false;
  }
}

async function getPromptForVideo(videoInfo: VideoInfo): Promise<string> {
  const settings = await storage.getSettings();

  if (settings.autoDetectCategory && videoInfo.platform === 'youtube' && settings.youtubeApiKey) {
    const categoryData = await fetchVideoCategory(videoInfo.videoId, settings.youtubeApiKey);

    if (categoryData?.categoryId) {
      const mappedPromptId = CATEGORY_TO_PROMPT[categoryData.categoryId];
      if (mappedPromptId) {
        return mappedPromptId;
      }
    }
  }

  return settings.defaultPromptId;
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  const handleMessage = async () => {
    switch (message.type) {
      case 'GET_VIDEO_INFO': {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          const videoInfo = await getVideoInfoFromTab(tabs[0].id);
          if (videoInfo && videoInfo.platform === 'youtube') {
            const settings = await storage.getSettings();
            if (settings.youtubeApiKey) {
              const categoryData = await fetchVideoCategory(videoInfo.videoId, settings.youtubeApiKey);
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

      case 'SUMMARIZE': {
        const request = message.payload as SummarizationRequest & { forceRegenerate?: boolean };
        const { videoId, platform } = request.videoInfo;

        // Check if already in progress for this video
        if (isVideoInProgress(videoId, platform)) {
          return {
            type: 'SUMMARIZE_RESPONSE',
            payload: {
              success: false,
              error: 'Summarization already in progress for this video',
              inProgress: true,
            },
          };
        }

        // Check cache first (unless forcing regeneration)
        if (!request.forceRegenerate) {
          const cached = await storage.getCachedSummary(videoId, platform);
          if (cached && cached.promptId === request.promptId) {
            return {
              type: 'SUMMARIZE_RESPONSE',
              payload: {
                success: true,
                summary: cached.summary,
                cached: true,
              },
            };
          }
        }

        // Mark as in progress
        markVideoInProgress(videoId, platform, request.promptId);

        const settings = await storage.getSettings();
        const timeoutMs = (settings.summarizationTimeoutMinutes || 5) * 60 * 1000;

        if (settings.streamResponse) {
          // Run async and return immediately for streaming
          summarizeVideo(request, timeoutMs, (chunk, done) => {
            chrome.runtime.sendMessage({
              type: 'SUMMARIZE_STREAM',
              payload: { chunk, done },
            }).catch((err) => {
              console.debug('[Media Summarizer] Stream chunk send failed (popup may be closed):', err);
            });
          }).then((result) => {
            markVideoComplete(videoId, platform);
            if (!result.success) {
              console.error('[Media Summarizer] Streaming summarization failed:', result.error);
              chrome.runtime.sendMessage({
                type: 'SUMMARIZE_RESPONSE',
                payload: result,
              }).catch((err) => {
                console.debug('[Media Summarizer] Error response send failed (popup may be closed):', err);
              });
            }
          }).catch((error) => {
            markVideoComplete(videoId, platform);
            console.error('[Media Summarizer] Streaming summarization error:', error);
            // Try to notify the popup about the error
            chrome.runtime.sendMessage({
              type: 'SUMMARIZE_RESPONSE',
              payload: {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }).catch(() => {});
          });
          return { type: 'SUMMARIZE_RESPONSE', payload: { success: true, summary: '', inProgress: true } };
        }

        // Non-streaming: wait for result
        try {
          const result = await summarizeVideo(request, timeoutMs);
          markVideoComplete(videoId, platform);
          return { type: 'SUMMARIZE_RESPONSE', payload: result };
        } catch (error) {
          markVideoComplete(videoId, platform);
          throw error;
        }
      }

      case 'GET_SETTINGS': {
        const settings = await storage.getSettings();
        return { type: 'SETTINGS_RESPONSE', payload: settings };
      }

      case 'GET_PROMPTS': {
        const prompts = await storage.getPrompts();
        return { type: 'PROMPTS_RESPONSE', payload: prompts };
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
        const inProgress = isVideoInProgress(videoId, platform);
        const info = inProgress ? inFlightRequests.get(getVideoKey(videoId, platform)) : null;
        return {
          type: 'IN_PROGRESS_RESPONSE',
          payload: {
            inProgress,
            startTime: info?.startTime,
            promptId: info?.promptId,
          },
        };
      }

      default:
        return null;
    }
  };

  handleMessage().then(sendResponse).catch((error) => {
    console.error('[Media Summarizer] Message handler error:', error);
    sendResponse({ error: String(error) });
  });

  return true;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    resetGeminiClient();
  }
});
