import type { Channel, ChannelVideo, ExtensionSettings } from '../shared/types';
import { storage } from './storage';
import { jobStore } from './job-store';
import { fetchChannelDetails, fetchChannelVideos, fetchVideoDurations } from './youtube-api';
import { notifyChannelUpdated } from './background-notifications';

const DAILY_CHANNEL_REFRESH_ALARM = 'daily-channel-refresh';
const DAILY_CHANNEL_REFRESH_PERIOD_MINUTES = 24 * 60;
const DAILY_CHANNEL_REFRESH_HOUR_LOCAL = 9;

export { DAILY_CHANNEL_REFRESH_ALARM };

export function isSubscribedChannel(channel: Channel | null | undefined): boolean {
  return channel?.subscribed !== false;
}

export function isChannelVideoNew(
  channel: Pick<Channel, 'addedAt' | 'newVideosSinceAt'>,
  video: ChannelVideo,
  succeededIds: Set<string>
): boolean {
  const baseline = channel.newVideosSinceAt ?? channel.addedAt;
  return video.publishedAt > baseline && !video.ignored && !succeededIds.has(video.videoId);
}

function getNextDailyRefreshTime(base = new Date()): number {
  const next = new Date(base);
  next.setHours(DAILY_CHANNEL_REFRESH_HOUR_LOCAL, 0, 0, 0);
  if (next.getTime() <= base.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

export async function scheduleDailyChannelRefresh(settings?: ExtensionSettings): Promise<void> {
  const currentSettings = settings ?? (await storage.getSettings());
  if (!currentSettings.autoRefreshChannelsDaily || !currentSettings.youtubeApiKey) {
    await chrome.alarms.clear(DAILY_CHANNEL_REFRESH_ALARM);
    return;
  }

  chrome.alarms.create(DAILY_CHANNEL_REFRESH_ALARM, {
    when: getNextDailyRefreshTime(),
    periodInMinutes: DAILY_CHANNEL_REFRESH_PERIOD_MINUTES,
  });
}

export async function syncChannelCatalog(
  channelId: string,
  settings: ExtensionSettings,
  subscribedOverride?: boolean
): Promise<Channel> {
  if (!settings.youtubeApiKey) {
    throw new Error('YouTube API key not configured');
  }

  const existing = await jobStore.getChannel(channelId);
  const channelDetails = await fetchChannelDetails(channelId, settings.youtubeApiKey);
  if (!channelDetails) {
    throw new Error('Could not fetch channel details');
  }

  const playlistVideos = await fetchChannelVideos(
    channelDetails.uploadsPlaylistId,
    settings.youtubeApiKey
  );

  const videoIds = playlistVideos.map((video) => video.videoId);
  const durations = await fetchVideoDurations(videoIds, settings.youtubeApiKey);
  const now = Date.now();
  const previousLastFetchedAt = existing?.lastFetchedAt;

  const channel: Channel = {
    channelId: channelDetails.channelId,
    title: channelDetails.title,
    thumbnailUrl: channelDetails.thumbnailUrl,
    uploadsPlaylistId: channelDetails.uploadsPlaylistId,
    addedAt:
      subscribedOverride === true && existing?.subscribed === false
        ? now
        : (existing?.addedAt ?? now),
    lastFetchedAt: now,
    newVideosSinceAt: previousLastFetchedAt ?? now,
    subscribed: subscribedOverride ?? existing?.subscribed ?? true,
  };

  const channelVideos: ChannelVideo[] = playlistVideos.map((video) => ({
    videoId: video.videoId,
    channelId: channel.channelId,
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: new Date(video.publishedAt).getTime(),
    duration: durations[video.videoId],
    ignored: false,
    discoveredAt: now,
  }));

  await jobStore.addChannel(channel);
  await jobStore.upsertChannelVideos(channelVideos);
  await jobStore.backfillChannelIdOnJobs(channel.channelId, channel.title, videoIds);
  notifyChannelUpdated(channel.channelId);

  return channel;
}

export async function refreshAllTrackedChannels(
  settings: ExtensionSettings
): Promise<{ refreshedCount: number; failedCount: number }> {
  if (!settings.youtubeApiKey) {
    throw new Error('YouTube API key not configured');
  }

  const storedChannels = await jobStore.listChannels();
  const discoveredChannels = await jobStore.getDiscoveredChannels();
  const refreshTargets = new Map<string, boolean>();

  for (const channel of storedChannels) {
    refreshTargets.set(channel.channelId, isSubscribedChannel(channel));
  }

  for (const [channelId] of discoveredChannels) {
    if (!refreshTargets.has(channelId)) {
      refreshTargets.set(channelId, false);
    }
  }

  let refreshedCount = 0;
  let failedCount = 0;

  for (const [channelId, subscribed] of refreshTargets) {
    try {
      await syncChannelCatalog(channelId, settings, subscribed);
      refreshedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.warn('Failed to refresh channel:', channelId, error);
    }
  }

  return { refreshedCount, failedCount };
}
