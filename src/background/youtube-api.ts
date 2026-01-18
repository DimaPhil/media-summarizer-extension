import { YOUTUBE_CATEGORIES } from '../shared/constants';

interface YouTubeVideoSnippet {
  categoryId: string;
  title: string;
  description: string;
  channelTitle: string;
  tags?: string[];
}

interface YouTubeVideoResponse {
  items?: Array<{
    snippet: YouTubeVideoSnippet;
    contentDetails?: {
      duration: string;
    };
  }>;
}

export async function fetchVideoCategory(
  videoId: string,
  apiKey: string
): Promise<{ categoryId: string; categoryName: string; title: string } | null> {
  if (!apiKey) {
    return null;
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('id', videoId);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());

    if (!response.ok) {
      console.warn('YouTube API request failed:', response.status);
      return null;
    }

    const data: YouTubeVideoResponse = await response.json();

    if (!data.items || data.items.length === 0) {
      return null;
    }

    const snippet = data.items[0].snippet;
    const categoryId = snippet.categoryId;
    const categoryName = YOUTUBE_CATEGORIES[categoryId] || 'Unknown';

    return {
      categoryId,
      categoryName,
      title: snippet.title,
    };
  } catch (error) {
    console.warn('Failed to fetch video category:', error);
    return null;
  }
}

export function parseDuration(isoDuration: string): string {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
