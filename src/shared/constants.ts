import type { ExtensionSettings } from './types';

export const GEMINI_MODEL = 'gemini-2.0-flash';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  geminiApiKey: '',
  youtubeApiKey: '',
  defaultPromptId: 'general',
  autoDetectCategory: true,
  streamResponse: true,
  theme: 'system',
  summarizationTimeoutMinutes: 5,
};

export const YOUTUBE_CATEGORIES: Record<string, string> = {
  '1': 'Film & Animation',
  '2': 'Autos & Vehicles',
  '10': 'Music',
  '15': 'Pets & Animals',
  '17': 'Sports',
  '18': 'Short Movies',
  '19': 'Travel & Events',
  '20': 'Gaming',
  '21': 'Videoblogging',
  '22': 'People & Blogs',
  '23': 'Comedy',
  '24': 'Entertainment',
  '25': 'News & Politics',
  '26': 'Howto & Style',
  '27': 'Education',
  '28': 'Science & Technology',
  '29': 'Nonprofits & Activism',
};

export const CATEGORY_TO_PROMPT: Record<string, string> = {
  '1': 'entertainment',
  '10': 'entertainment',
  '17': 'news',
  '20': 'entertainment',
  '22': 'podcast',
  '23': 'entertainment',
  '24': 'entertainment',
  '25': 'news',
  '26': 'tutorial',
  '27': 'educational',
  '28': 'technical',
};

export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  PROMPTS: 'prompts',
  CACHE: 'summaryCache',
} as const;

export const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  youtube: [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ],
  vimeo: [
    /vimeo\.com\/(\d+)/,
    /player\.vimeo\.com\/video\/(\d+)/,
  ],
};
