export enum ErrorCode {
  NO_VIDEO_DETECTED = 'NO_VIDEO_DETECTED',
  INVALID_API_KEY = 'INVALID_API_KEY',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  VIDEO_TOO_LONG = 'VIDEO_TOO_LONG',
  PRIVATE_VIDEO = 'PRIVATE_VIDEO',
  VIDEO_ACCESS_DENIED = 'VIDEO_ACCESS_DENIED',
  CONTENT_BLOCKED = 'CONTENT_BLOCKED',
  MODEL_OVERLOADED = 'MODEL_OVERLOADED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM',
  NO_API_KEY = 'NO_API_KEY',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.NO_VIDEO_DETECTED]: 'No video detected on this page. Navigate to a video page.',
  [ErrorCode.INVALID_API_KEY]: 'Invalid API key. Check your settings.',
  [ErrorCode.API_RATE_LIMIT]: 'API rate limit exceeded. Try again later.',
  [ErrorCode.VIDEO_TOO_LONG]: 'Video exceeds the daily limit (8 hours for free tier).',
  [ErrorCode.PRIVATE_VIDEO]: 'Cannot summarize private or unlisted videos.',
  [ErrorCode.VIDEO_ACCESS_DENIED]:
    "Gemini couldn't access this video. It may be age-restricted, region-locked, or have embedding disabled by the creator.",
  [ErrorCode.CONTENT_BLOCKED]:
    'Gemini blocked this request due to content safety filters. The video content may violate usage policies.',
  [ErrorCode.MODEL_OVERLOADED]:
    'The Gemini API is temporarily overloaded. Please try again in a few minutes.',
  [ErrorCode.NETWORK_ERROR]: 'Network error. Check your connection.',
  [ErrorCode.UNSUPPORTED_PLATFORM]: 'This video platform is not supported.',
  [ErrorCode.NO_API_KEY]: 'No API key configured. Add your Gemini API key in settings.',
  [ErrorCode.TIMEOUT]: 'Summarization timed out. Try again or increase timeout in settings.',
  [ErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred.',
};

export class SummarizationError extends Error {
  code: ErrorCode;
  details?: string;

  constructor(code: ErrorCode, details?: string) {
    const base = ERROR_MESSAGES[code];
    super(details ? `${base} (${details})` : base);
    this.name = 'SummarizationError';
    this.code = code;
    this.details = details;
  }

  /** User-friendly message without raw details. */
  get userMessage(): string {
    return ERROR_MESSAGES[this.code];
  }
}

export function parseGeminiError(error: unknown): SummarizationError {
  if (error instanceof SummarizationError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('api key') ||
    lowerMessage.includes('401') ||
    lowerMessage.includes('unauthorized')
  ) {
    return new SummarizationError(ErrorCode.INVALID_API_KEY, message);
  }

  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('429') ||
    lowerMessage.includes('quota') ||
    lowerMessage.includes('resource_exhausted')
  ) {
    return new SummarizationError(ErrorCode.API_RATE_LIMIT, message);
  }

  if (
    (lowerMessage.includes('403') || lowerMessage.includes('permission_denied')) &&
    !lowerMessage.includes('api key')
  ) {
    return new SummarizationError(ErrorCode.VIDEO_ACCESS_DENIED, message);
  }

  if (
    lowerMessage.includes('safety') ||
    lowerMessage.includes('blocked') ||
    lowerMessage.includes('recitation') ||
    lowerMessage.includes('harm_category')
  ) {
    return new SummarizationError(ErrorCode.CONTENT_BLOCKED, message);
  }

  if (lowerMessage.includes('503') || lowerMessage.includes('overloaded')) {
    return new SummarizationError(ErrorCode.MODEL_OVERLOADED, message);
  }

  if (lowerMessage.includes('private') || lowerMessage.includes('unavailable')) {
    return new SummarizationError(ErrorCode.PRIVATE_VIDEO, message);
  }

  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('connection')
  ) {
    return new SummarizationError(ErrorCode.NETWORK_ERROR, message);
  }

  return new SummarizationError(ErrorCode.UNKNOWN_ERROR, message);
}
