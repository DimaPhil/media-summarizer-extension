export enum ErrorCode {
  NO_VIDEO_DETECTED = 'NO_VIDEO_DETECTED',
  INVALID_API_KEY = 'INVALID_API_KEY',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  VIDEO_TOO_LONG = 'VIDEO_TOO_LONG',
  PRIVATE_VIDEO = 'PRIVATE_VIDEO',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM',
  NO_API_KEY = 'NO_API_KEY',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.NO_VIDEO_DETECTED]: 'No video detected on this page. Navigate to a video page.',
  [ErrorCode.INVALID_API_KEY]: 'Invalid API key. Check your settings.',
  [ErrorCode.API_RATE_LIMIT]: 'API rate limit exceeded. Try again later.',
  [ErrorCode.VIDEO_TOO_LONG]: 'Video exceeds the daily limit (8 hours for free tier).',
  [ErrorCode.PRIVATE_VIDEO]: 'Cannot summarize private or unlisted videos.',
  [ErrorCode.NETWORK_ERROR]: 'Network error. Check your connection.',
  [ErrorCode.UNSUPPORTED_PLATFORM]: 'This video platform is not supported.',
  [ErrorCode.NO_API_KEY]: 'No API key configured. Add your Gemini API key in settings.',
  [ErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred.',
};

export class SummarizationError extends Error {
  code: ErrorCode;
  details?: string;

  constructor(code: ErrorCode, details?: string) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SummarizationError';
    this.code = code;
    this.details = details;
  }
}

export function parseGeminiError(error: unknown): SummarizationError {
  if (error instanceof SummarizationError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('api key') || lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
    return new SummarizationError(ErrorCode.INVALID_API_KEY, message);
  }

  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || lowerMessage.includes('quota')) {
    return new SummarizationError(ErrorCode.API_RATE_LIMIT, message);
  }

  if (lowerMessage.includes('private') || lowerMessage.includes('unavailable')) {
    return new SummarizationError(ErrorCode.PRIVATE_VIDEO, message);
  }

  if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || lowerMessage.includes('connection')) {
    return new SummarizationError(ErrorCode.NETWORK_ERROR, message);
  }

  return new SummarizationError(ErrorCode.UNKNOWN_ERROR, message);
}
