import { YOUTUBE_CATEGORIES, CHANNEL_FETCH_MAX_RESULTS } from '../shared/constants';

interface YouTubeVideoSnippet {
  categoryId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  tags?: string[];
  thumbnails?: {
    default?: { url: string };
    medium?: { url: string };
    high?: { url: string };
  };
}

interface YouTubeVideoResponse {
  items?: Array<{
    id?: string;
    snippet: YouTubeVideoSnippet;
    contentDetails?: {
      duration: string;
    };
  }>;
}

export interface YouTubeVideoDetails {
  categoryId: string;
  categoryName: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  duration?: string;
}

export interface YouTubeChannelDetails {
  channelId: string;
  title: string;
  thumbnailUrl?: string;
  uploadsPlaylistId: string;
}

export interface YouTubePlaylistVideo {
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  publishedAt: string;
  channelId: string;
}

export async function fetchVideoDetails(
  videoId: string,
  apiKey: string
): Promise<YouTubeVideoDetails | null> {
  if (!apiKey) return null;

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
    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    const snippet = item.snippet;
    const categoryId = snippet.categoryId;
    const categoryName = YOUTUBE_CATEGORIES[categoryId] || 'Unknown';

    return {
      categoryId,
      categoryName,
      title: snippet.title,
      channelId: snippet.channelId,
      channelTitle: snippet.channelTitle,
      publishedAt: snippet.publishedAt,
      duration: item.contentDetails?.duration
        ? parseDuration(item.contentDetails.duration)
        : undefined,
    };
  } catch (error) {
    console.warn('Failed to fetch video details:', error);
    return null;
  }
}

/** Batch fetch video details for up to 50 IDs per call */
export async function fetchVideoDetailsBatch(
  videoIds: string[],
  apiKey: string
): Promise<Map<string, YouTubeVideoDetails>> {
  const results = new Map<string, YouTubeVideoDetails>();
  if (!apiKey || !videoIds.length) return results;

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('part', 'snippet,contentDetails');
      url.searchParams.set('id', batch.join(','));
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString());
      if (!response.ok) continue;

      const data: YouTubeVideoResponse = await response.json();
      if (!data.items) continue;

      for (const item of data.items) {
        const snippet = item.snippet;
        const categoryId = snippet.categoryId;
        results.set(item.id || '', {
          categoryId,
          categoryName: YOUTUBE_CATEGORIES[categoryId] || 'Unknown',
          title: snippet.title,
          channelId: snippet.channelId,
          channelTitle: snippet.channelTitle,
          publishedAt: snippet.publishedAt,
          duration: item.contentDetails?.duration
            ? parseDuration(item.contentDetails.duration)
            : undefined,
        });
      }
    } catch {
      // continue with remaining batches
    }
  }

  return results;
}

/** Backward-compatible wrapper */
export async function fetchVideoCategory(
  videoId: string,
  apiKey: string
): Promise<{ categoryId: string; categoryName: string; title: string } | null> {
  const details = await fetchVideoDetails(videoId, apiKey);
  if (!details) return null;
  return {
    categoryId: details.categoryId,
    categoryName: details.categoryName,
    title: details.title,
  };
}

interface YouTubeChannelApiItem {
  id: string;
  snippet: {
    title: string;
    thumbnails?: {
      default?: { url: string };
      medium?: { url: string };
    };
  };
  contentDetails: {
    relatedPlaylists: {
      uploads: string;
    };
  };
}

interface YouTubeChannelApiResponse {
  items?: YouTubeChannelApiItem[];
}

export async function fetchChannelDetails(
  channelId: string,
  apiKey: string
): Promise<YouTubeChannelDetails | null> {
  if (!apiKey) return null;

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('id', channelId);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn('YouTube channels API request failed:', response.status);
      return null;
    }

    const data: YouTubeChannelApiResponse = await response.json();
    if (!data.items || data.items.length === 0) return null;

    const item = data.items[0];
    return {
      channelId: item.id,
      title: item.snippet.title,
      thumbnailUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    };
  } catch (error) {
    console.warn('Failed to fetch channel details:', error);
    return null;
  }
}

/** Batch fetch channel thumbnails for up to 50 IDs per call */
export async function fetchChannelThumbnails(
  channelIds: string[],
  apiKey: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!apiKey || !channelIds.length) return result;

  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('id', batch.join(','));
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString());
      if (!response.ok) continue;

      const data: YouTubeChannelApiResponse = await response.json();
      if (!data.items) continue;

      for (const item of data.items) {
        const thumb = item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url;
        if (thumb) result.set(item.id, thumb);
      }
    } catch {
      // continue
    }
  }

  return result;
}

export async function fetchChannelVideos(
  uploadsPlaylistId: string,
  apiKey: string,
  maxPages = 2
): Promise<YouTubePlaylistVideo[]> {
  const videos: YouTubePlaylistVideo[] = [];
  let pageToken: string | undefined;

  interface PlaylistResponse {
    items?: Array<{
      snippet: {
        resourceId: { videoId: string };
        title: string;
        channelId: string;
        publishedAt: string;
        thumbnails?: {
          medium?: { url: string };
          default?: { url: string };
        };
      };
    }>;
    nextPageToken?: string;
  }

  for (let page = 0; page < maxPages; page++) {
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('playlistId', uploadsPlaylistId);
      url.searchParams.set('maxResults', String(CHANNEL_FETCH_MAX_RESULTS));
      url.searchParams.set('key', apiKey);
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        console.warn('YouTube playlistItems API request failed:', response.status);
        break;
      }

      const data: PlaylistResponse = await response.json();
      if (!data.items || data.items.length === 0) break;

      for (const item of data.items) {
        videos.push({
          videoId: item.snippet.resourceId.videoId,
          title: item.snippet.title,
          thumbnailUrl:
            item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
          publishedAt: item.snippet.publishedAt,
          channelId: item.snippet.channelId,
        });
      }

      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    } catch (error) {
      console.warn('Failed to fetch playlist items:', error);
      break;
    }
  }

  return videos;
}

export async function fetchVideoDurations(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, string>> {
  if (!videoIds.length || !apiKey) return {};

  const durations: Record<string, string> = {};

  // Process in batches of 50 (YouTube API limit)
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('part', 'contentDetails');
      url.searchParams.set('id', batch.join(','));
      url.searchParams.set('key', apiKey);

      const response = await fetch(url.toString());
      if (!response.ok) continue;

      const data: YouTubeVideoResponse = await response.json();
      if (!data.items) continue;

      for (const item of data.items) {
        if (item.id && item.contentDetails?.duration) {
          durations[item.id] = parseDuration(item.contentDetails.duration);
        }
      }
    } catch {
      // continue with remaining batches
    }
  }

  return durations;
}

export function getUploadsPlaylistId(channelId: string): string {
  return 'UU' + channelId.slice(2);
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
