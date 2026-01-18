export interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
  isDefault: boolean;
  mappedCategories: string[];
}

export interface ExtensionSettings {
  geminiApiKey: string;
  youtubeApiKey: string;
  defaultPromptId: string;
  autoDetectCategory: boolean;
  streamResponse: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface StorageData {
  settings: ExtensionSettings;
  prompts: PromptTemplate[];
}

export interface VideoInfo {
  url: string;
  videoId: string;
  platform: Platform;
  title: string;
  duration?: string;
  categoryId?: string;
  categoryName?: string;
}

export type Platform = 'youtube' | 'vimeo' | 'unknown';

export interface SummarizationRequest {
  videoInfo: VideoInfo;
  promptId: string;
}

export interface SummarizationResult {
  success: boolean;
  summary?: string;
  error?: string;
}

export type MessageType =
  | 'GET_VIDEO_INFO'
  | 'VIDEO_INFO_RESPONSE'
  | 'SUMMARIZE'
  | 'SUMMARIZE_RESPONSE'
  | 'SUMMARIZE_STREAM'
  | 'GET_SETTINGS'
  | 'SETTINGS_RESPONSE'
  | 'GET_PROMPTS'
  | 'PROMPTS_RESPONSE'
  | 'TEST_API_KEY'
  | 'API_KEY_TEST_RESULT';

export interface Message {
  type: MessageType;
  payload?: unknown;
}

export interface VideoInfoMessage extends Message {
  type: 'VIDEO_INFO_RESPONSE';
  payload: VideoInfo | null;
}

export interface SummarizeMessage extends Message {
  type: 'SUMMARIZE';
  payload: SummarizationRequest;
}

export interface SummarizeResponseMessage extends Message {
  type: 'SUMMARIZE_RESPONSE';
  payload: SummarizationResult;
}

export interface StreamChunkMessage extends Message {
  type: 'SUMMARIZE_STREAM';
  payload: {
    chunk: string;
    done: boolean;
  };
}
