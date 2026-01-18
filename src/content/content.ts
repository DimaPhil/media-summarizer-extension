import type { Platform, VideoInfo, Message } from '../shared/types';
import { PLATFORM_PATTERNS } from '../shared/constants';

function detectPlatform(url: string): Platform {
  if (PLATFORM_PATTERNS.youtube.some((p) => p.test(url))) {
    return 'youtube';
  }
  if (PLATFORM_PATTERNS.vimeo.some((p) => p.test(url))) {
    return 'vimeo';
  }
  return 'unknown';
}

function extractVideoId(url: string, platform: Platform): string | null {
  const patterns = PLATFORM_PATTERNS[platform];
  if (!patterns) return null;

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

function getYouTubeTitle(): string {
  const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string');
  if (titleElement?.textContent) {
    return titleElement.textContent.trim();
  }

  const metaTitle = document.querySelector('meta[name="title"]');
  if (metaTitle) {
    return metaTitle.getAttribute('content') || '';
  }

  return document.title.replace(' - YouTube', '').trim();
}

function getYouTubeDuration(): string | undefined {
  const timeDisplay = document.querySelector('.ytp-time-duration');
  return timeDisplay?.textContent || undefined;
}

function getVimeoTitle(): string {
  const titleElement = document.querySelector('h1[data-testid="VideoTitle"]');
  if (titleElement?.textContent) {
    return titleElement.textContent.trim();
  }
  return document.title.replace(' on Vimeo', '').trim();
}

function getVideoInfo(): VideoInfo | null {
  const url = window.location.href;
  const platform = detectPlatform(url);

  if (platform === 'unknown') {
    return null;
  }

  const videoId = extractVideoId(url, platform);
  if (!videoId) {
    return null;
  }

  let title = '';
  let duration: string | undefined;

  switch (platform) {
    case 'youtube':
      title = getYouTubeTitle();
      duration = getYouTubeDuration();
      break;
    case 'vimeo':
      title = getVimeoTitle();
      break;
  }

  const videoUrl = platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${videoId}`
    : url;

  return {
    url: videoUrl,
    videoId,
    platform,
    title: title || 'Untitled Video',
    duration,
  };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'GET_VIDEO_INFO') {
    const videoInfo = getVideoInfo();
    sendResponse({ type: 'VIDEO_INFO_RESPONSE', payload: videoInfo });
  }
  return true;
});

const videoInfo = getVideoInfo();
if (videoInfo) {
  console.log('[Media Summarizer] Video detected:', videoInfo.title);
}
