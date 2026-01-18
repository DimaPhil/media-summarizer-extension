import type {
  Message,
  SummarizationRequest,
  SummarizationResult,
  VideoInfo,
  PromptTemplate,
  ExtensionSettings,
} from '../shared/types';
import { CATEGORY_TO_PROMPT } from '../shared/constants';
import { ErrorCode, SummarizationError, ERROR_MESSAGES } from '../shared/errors';
import { storage } from './storage';
import { GeminiClient, resetGeminiClient } from './gemini-client';
import { fetchVideoCategory } from './youtube-api';

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
  request: SummarizationRequest,
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
    const client = new GeminiClient(settings.geminiApiKey);

    if (request.videoInfo.platform !== 'youtube') {
      return {
        success: false,
        error: ERROR_MESSAGES[ErrorCode.UNSUPPORTED_PLATFORM],
      };
    }

    if (settings.streamResponse && sendStreamChunk) {
      let fullText = '';
      const stream = client.summarizeYouTubeVideoStream(request.videoInfo, prompt.prompt);

      for await (const chunk of stream) {
        fullText += chunk;
        sendStreamChunk(chunk, false);
      }

      sendStreamChunk('', true);

      return {
        success: true,
        summary: fullText,
      };
    } else {
      const summary = await client.summarizeYouTubeVideo(request.videoInfo, prompt.prompt);
      return {
        success: true,
        summary,
      };
    }
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
        const request = message.payload as SummarizationRequest;
        const settings = await storage.getSettings();

        if (settings.streamResponse) {
          const tabId = sender.tab?.id;
          if (tabId) {
            summarizeVideo(request, (chunk, done) => {
              chrome.runtime.sendMessage({
                type: 'SUMMARIZE_STREAM',
                payload: { chunk, done },
              }).catch(() => {});
            }).then((result) => {
              if (!result.success) {
                chrome.runtime.sendMessage({
                  type: 'SUMMARIZE_RESPONSE',
                  payload: result,
                }).catch(() => {});
              }
            });
            return { type: 'SUMMARIZE_RESPONSE', payload: { success: true, summary: '' } };
          }
        }

        const result = await summarizeVideo(request);
        return { type: 'SUMMARIZE_RESPONSE', payload: result };
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
