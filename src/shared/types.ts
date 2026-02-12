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
  summarizationTimeoutMinutes: number;
  geminiModel: string;
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
  cached?: boolean;
  inProgress?: boolean;
  jobId?: string;
  status?: JobStatus;
}

export interface InProgressStatus {
  inProgress: boolean;
  startTime?: number;
  promptId?: string;
  jobId?: string;
}

export interface CachedSummary {
  videoId: string;
  platform: Platform;
  videoTitle: string;
  videoUrl: string;
  promptId: string;
  promptName: string;
  summary: string;
  timestamp: number;
}

export type JobStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface JobSegment {
  index: number;
  startSec: number;
  endSec: number;
  outputText: string;
}

export interface JobModelSnapshot {
  model: string;
  streamResponse: boolean;
  summarizationTimeoutMinutes: number;
  chunkingUsed: boolean;
  chunkDurationSec?: number;
  chunkOverlapSec?: number;
}

export interface Job {
  jobId: string;
  videoKey: string;
  platform: Platform;
  videoId: string;
  videoUrl: string;
  videoTitle: string;
  thumbnailUrl?: string;
  categoryId?: string;
  categoryName?: string;
  promptId: string;
  promptName: string;
  promptTextSnapshot: string;
  modelSnapshot: JobModelSnapshot;
  status: JobStatus;
  createdAt: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  outputText: string;
  editedText?: string;
  errorMessage?: string;
  segments?: JobSegment[];
  mergeOutputText?: string;
}

export interface JobListQuery {
  status?: JobStatus;
  limit?: number;
}

export interface StartJobRequest {
  videoInfo: VideoInfo;
  promptId: string;
  forceRegenerate?: boolean;
}

export type MessageType =
  | 'GET_VIDEO_INFO'
  | 'VIDEO_INFO_RESPONSE'
  | 'SUMMARIZE'
  | 'START_JOB'
  | 'SUMMARIZE_RESPONSE'
  | 'SUMMARIZE_STREAM'
  | 'JOB_UPDATED'
  | 'GET_SETTINGS'
  | 'SETTINGS_RESPONSE'
  | 'SAVE_SETTINGS'
  | 'GET_PROMPTS'
  | 'PROMPTS_RESPONSE'
  | 'SAVE_PROMPTS'
  | 'RESET_DEFAULTS'
  | 'TEST_API_KEY'
  | 'API_KEY_TEST_RESULT'
  | 'GET_CACHED_SUMMARY'
  | 'CACHED_SUMMARY_RESPONSE'
  | 'CLEAR_CACHED_SUMMARY'
  | 'GET_ALL_CACHED_SUMMARIES'
  | 'CHECK_IN_PROGRESS'
  | 'IN_PROGRESS_RESPONSE'
  | 'GET_ACTIVE_JOB'
  | 'ACTIVE_JOB_RESPONSE'
  | 'GET_JOB'
  | 'JOB_RESPONSE'
  | 'LIST_JOBS'
  | 'LIST_JOBS_RESPONSE'
  | 'UPDATE_JOB_EDITED_TEXT'
  | 'DELETE_JOB'
  | 'CLEAR_ALL_JOBS';

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
