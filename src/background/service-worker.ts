import type {
  ExtensionSettings,
  Job,
  JobListQuery,
  Message,
  Platform,
  PromptTemplate,
  StartJobRequest,
  VideoInfo,
} from '../shared/types';
import { storage } from './storage';
import { jobStore } from './job-store';
import { ensureBackgroundInitialized } from './background-init';
import {
  DAILY_CHANNEL_REFRESH_ALARM,
  isChannelVideoNew,
  isSubscribedChannel,
  refreshAllTrackedChannels,
  scheduleDailyChannelRefresh,
  syncChannelCatalog,
} from './channel-sync';
import { cancelRunningJob, getFreshActiveJob, startJob, testApiKey } from './job-runner';
import { notifyChannelUpdated, notifyJobUpdated } from './background-notifications';
import { fetchChannelThumbnails, fetchVideoDetails, fetchVideoDetailsBatch } from './youtube-api';

async function getVideoInfoFromTab(tabId: number): Promise<VideoInfo | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_INFO' });
    return response?.payload || null;
  } catch {
    return null;
  }
}

async function handleMessage(
  message: Message | { type: string; payload?: unknown }
): Promise<unknown> {
  await ensureBackgroundInitialized();

  switch (message.type) {
    case 'GET_VIDEO_INFO': {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const videoInfo = await getVideoInfoFromTab(tabs[0].id);
        if (videoInfo && videoInfo.platform === 'youtube') {
          const settings = await storage.getSettings();
          if (settings.youtubeApiKey) {
            const details = await fetchVideoDetails(videoInfo.videoId, settings.youtubeApiKey);
            if (details) {
              videoInfo.categoryId = details.categoryId;
              videoInfo.categoryName = details.categoryName;
              videoInfo.title = details.title || videoInfo.title;
              videoInfo.channelId = details.channelId;
              videoInfo.channelTitle = details.channelTitle;
              if (details.duration) {
                videoInfo.duration = details.duration;
              }
            }
          }
        }
        return { type: 'VIDEO_INFO_RESPONSE', payload: videoInfo };
      }
      return { type: 'VIDEO_INFO_RESPONSE', payload: null };
    }

    case 'SUMMARIZE':
    case 'START_JOB': {
      const request = message.payload as StartJobRequest;
      const result = await startJob(request);
      return { type: 'SUMMARIZE_RESPONSE', payload: result };
    }

    case 'GET_SETTINGS': {
      const settings = await storage.getSettings();
      return { type: 'SETTINGS_RESPONSE', payload: settings };
    }

    case 'SAVE_SETTINGS': {
      const settings = message.payload as ExtensionSettings;
      await storage.saveSettings(settings);
      await scheduleDailyChannelRefresh(settings);
      return { type: 'SETTINGS_RESPONSE', payload: settings };
    }

    case 'GET_PROMPTS': {
      const prompts = await storage.getPrompts();
      return { type: 'PROMPTS_RESPONSE', payload: prompts };
    }

    case 'SAVE_PROMPTS': {
      const prompts = message.payload as PromptTemplate[];
      await storage.savePrompts(prompts);
      return { type: 'PROMPTS_RESPONSE', payload: prompts };
    }

    case 'RESET_DEFAULTS': {
      await storage.resetToDefaults();
      const allData = await storage.getAllData();
      return { type: 'SETTINGS_RESPONSE', payload: allData };
    }

    case 'TEST_API_KEY': {
      const apiKey = message.payload as string;
      const isValid = await testApiKey(apiKey);
      return { type: 'API_KEY_TEST_RESULT', payload: isValid };
    }

    case 'GET_CACHED_SUMMARY': {
      const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
      const cached = await storage.getCachedSummary(videoId, platform);
      return { type: 'CACHED_SUMMARY_RESPONSE', payload: cached };
    }

    case 'CLEAR_CACHED_SUMMARY': {
      const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
      await storage.clearCachedSummary(videoId, platform);
      return { type: 'CACHED_SUMMARY_RESPONSE', payload: null };
    }

    case 'GET_ALL_CACHED_SUMMARIES': {
      const summaries = await storage.getAllCachedSummaries();
      return { type: 'CACHED_SUMMARY_RESPONSE', payload: summaries };
    }

    case 'CHECK_IN_PROGRESS': {
      const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
      const activeJob = await getFreshActiveJob(videoId, platform);
      return {
        type: 'IN_PROGRESS_RESPONSE',
        payload: {
          inProgress: Boolean(activeJob && activeJob.status === 'RUNNING'),
          startTime: activeJob?.startedAt,
          promptId: activeJob?.promptId,
          jobId: activeJob?.jobId,
        },
      };
    }

    case 'GET_ACTIVE_JOB': {
      const { videoId, platform } = message.payload as { videoId: string; platform: Platform };
      const activeJob = await getFreshActiveJob(videoId, platform);
      return { type: 'ACTIVE_JOB_RESPONSE', payload: activeJob };
    }

    case 'GET_JOB': {
      const { jobId } = message.payload as { jobId: string };
      const job = await jobStore.getJob(jobId);
      return { type: 'JOB_RESPONSE', payload: job };
    }

    case 'LIST_JOBS': {
      const query = (message.payload || {}) as JobListQuery;
      const jobs = await jobStore.listJobs(query);
      return { type: 'LIST_JOBS_RESPONSE', payload: jobs };
    }

    case 'UPDATE_JOB_EDITED_TEXT': {
      const payload = message.payload as { jobId: string; editedText: string };
      const job = await jobStore.updateEditedText(payload.jobId, payload.editedText);
      if (job) {
        notifyJobUpdated(job.jobId);
      }
      return { type: 'JOB_RESPONSE', payload: job };
    }

    case 'DELETE_JOB': {
      const payload = message.payload as { jobId: string };
      const deleted = await jobStore.deleteJob(payload.jobId);
      return { type: 'JOB_RESPONSE', payload: { deleted } };
    }

    case 'CLEAR_ALL_JOBS': {
      await jobStore.clearAllJobs();
      return { type: 'JOB_RESPONSE', payload: { success: true } };
    }

    case 'ADD_CHANNEL': {
      const payload = message.payload as { videoId?: string; channelId?: string };
      const settings = await storage.getSettings();
      if (!settings.youtubeApiKey) {
        return { error: 'YouTube API key not configured' };
      }

      let channelId = payload.channelId;

      if (!channelId && payload.videoId) {
        const details = await fetchVideoDetails(payload.videoId, settings.youtubeApiKey);
        if (!details) {
          return { error: 'Could not find video details' };
        }
        channelId = details.channelId;
      }

      if (!channelId) {
        return { error: 'No channel ID provided or resolved' };
      }

      const existing = await jobStore.getChannel(channelId);
      if (existing) {
        if (isSubscribedChannel(existing)) {
          return { type: 'CHANNEL_UPDATED', payload: existing };
        }

        const upgradedChannel = await syncChannelCatalog(channelId, settings, true);
        return { type: 'CHANNEL_UPDATED', payload: upgradedChannel };
      }

      const channel = await syncChannelCatalog(channelId, settings, true);
      return { type: 'CHANNEL_UPDATED', payload: channel };
    }

    case 'REMOVE_CHANNEL': {
      const { channelId } = message.payload as { channelId: string };
      await jobStore.removeChannel(channelId);
      return { type: 'CHANNEL_UPDATED', payload: { removed: true, channelId } };
    }

    case 'LIST_CHANNELS': {
      const channels = await jobStore.listChannels();
      const channelsWithCounts = await Promise.all(
        channels.map(async (channel) => {
          const videos = await jobStore.listChannelVideos(channel.channelId);
          const videoIds = videos.map((video) => video.videoId);
          const succeededIds = await jobStore.getSucceededVideoIds(videoIds);
          const newCount = videos.filter((video) =>
            isChannelVideoNew(channel, video, succeededIds)
          ).length;
          return {
            ...channel,
            subscribed: isSubscribedChannel(channel),
            newCount,
            totalCount: videos.length,
          };
        })
      );

      const discovered = await jobStore.getDiscoveredChannels();
      if (discovered.size > 0) {
        const settings = await storage.getSettings();
        const discoveredIds = [...discovered.keys()];
        const thumbnails = settings.youtubeApiKey
          ? await fetchChannelThumbnails(discoveredIds, settings.youtubeApiKey)
          : new Map<string, string>();

        for (const [, entry] of discovered) {
          channelsWithCounts.push({
            channelId: entry.channelId,
            title: entry.channelTitle,
            thumbnailUrl: thumbnails.get(entry.channelId),
            uploadsPlaylistId: '',
            addedAt: 0,
            subscribed: false,
            newCount: 0,
            totalCount: entry.videoIds.size,
          });
        }
      }

      return { type: 'LIST_CHANNELS_RESPONSE', payload: channelsWithCounts };
    }

    case 'FETCH_CHANNEL_VIDEOS': {
      const { channelId } = message.payload as { channelId: string };
      const channel = await jobStore.getChannel(channelId);
      if (!channel) {
        return { error: 'Channel not found' };
      }

      const settings = await storage.getSettings();
      if (!settings.youtubeApiKey) {
        return { error: 'YouTube API key not configured' };
      }

      await syncChannelCatalog(channelId, settings, isSubscribedChannel(channel));
      return { type: 'CHANNEL_VIDEOS_RESPONSE', payload: { success: true } };
    }

    case 'REFRESH_ALL_CHANNELS': {
      const settings = await storage.getSettings();
      const { refreshedCount, failedCount } = await refreshAllTrackedChannels(settings);
      return { type: 'CHANNEL_UPDATED', payload: { refreshedCount, failedCount } };
    }

    case 'LIST_CHANNEL_VIDEOS': {
      const { channelId } = message.payload as { channelId: string };
      const channel = await jobStore.getChannel(channelId);
      const storedVideos = await jobStore.listChannelVideos(channelId);

      if (channel || storedVideos.length > 0) {
        const videoIds = storedVideos.map((video) => video.videoId);
        const succeededIds = await jobStore.getSucceededVideoIds(videoIds);
        const runningIds = await jobStore.getRunningVideoIds(videoIds);
        const failedIds = await jobStore.getFailedVideoIds(videoIds);

        const annotated = storedVideos.map((video) => ({
          ...video,
          hasTranscription: succeededIds.has(video.videoId),
          isRunning: runningIds.has(video.videoId),
          isFailed: failedIds.has(video.videoId) && !succeededIds.has(video.videoId),
          isNew: isChannelVideoNew(channel || { addedAt: 0 }, video, succeededIds),
        }));
        return { type: 'CHANNEL_VIDEOS_RESPONSE', payload: annotated };
      }

      const channelJobs = await jobStore.listJobsByChannel(channelId);
      const videoMap = new Map<
        string,
        { job: Job; hasTranscription: boolean; isRunning: boolean; isFailed: boolean }
      >();

      for (const job of channelJobs) {
        const existing = videoMap.get(job.videoId);
        const succeeded = job.status === 'SUCCEEDED';
        const running = job.status === 'RUNNING';
        const failed = job.status === 'FAILED';
        if (!existing) {
          videoMap.set(job.videoId, {
            job,
            hasTranscription: succeeded,
            isRunning: running,
            isFailed: failed,
          });
        } else {
          if (succeeded) existing.hasTranscription = true;
          if (running) existing.isRunning = true;
          if (failed) existing.isFailed = true;
        }
      }

      const annotated = Array.from(videoMap.values()).map(
        ({ job, hasTranscription, isRunning, isFailed }) => ({
          videoId: job.videoId,
          channelId: job.channelId || channelId,
          title: job.videoTitle,
          thumbnailUrl: job.thumbnailUrl,
          publishedAt: job.createdAt,
          duration: undefined as string | undefined,
          ignored: false,
          discoveredAt: job.createdAt,
          hasTranscription,
          isRunning: isRunning && !hasTranscription,
          isFailed: isFailed && !hasTranscription,
          isNew: false,
        })
      );

      return { type: 'CHANNEL_VIDEOS_RESPONSE', payload: annotated };
    }

    case 'IGNORE_VIDEO': {
      const { videoId, ignored } = message.payload as { videoId: string; ignored: boolean };
      const updated = await jobStore.setVideoIgnored(videoId, ignored);
      if (updated) {
        notifyChannelUpdated(updated.channelId);
      }
      return { type: 'CHANNEL_VIDEOS_RESPONSE', payload: updated };
    }

    case 'BATCH_TRANSCRIBE': {
      const { channelId, promptId } = message.payload as {
        channelId: string;
        promptId: string;
      };
      const videos = await jobStore.listChannelVideos(channelId);
      const videoIds = videos.map((video) => video.videoId);
      const succeededIds = await jobStore.getSucceededVideoIds(videoIds);
      const channel = await jobStore.getChannel(channelId);
      const newVideos = videos.filter((video) =>
        isChannelVideoNew(channel || { addedAt: 0 }, video, succeededIds)
      );

      const results: Array<{ videoId: string; jobId?: string; error?: string }> = [];

      for (const video of newVideos) {
        const videoInfo: VideoInfo = {
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          videoId: video.videoId,
          platform: 'youtube',
          title: video.title,
          duration: video.duration,
          channelId: video.channelId,
          channelTitle: channel?.title,
        };

        const result = await startJob({
          videoInfo,
          promptId,
          forceRegenerate: false,
        });

        results.push({
          videoId: video.videoId,
          jobId: result.jobId,
          error: result.error,
        });
      }

      return { type: 'BATCH_TRANSCRIBE_RESPONSE', payload: results };
    }

    case 'CANCEL_JOB': {
      const { jobId } = message.payload as { jobId: string };
      await cancelRunningJob(jobId);
      return { type: 'JOB_RESPONSE', payload: { canceled: true } };
    }

    case 'BACKFILL_CHANNEL_IDS': {
      const settings = await storage.getSettings();
      if (!settings.youtubeApiKey) {
        return { error: 'YouTube API key not configured' };
      }

      const jobsMissing = await jobStore.getJobsMissingChannelId();
      if (jobsMissing.length === 0) {
        return { type: 'CHANNEL_UPDATED', payload: { backfilled: 0 } };
      }

      const uniqueVideoIds = [...new Set(jobsMissing.map((job) => job.videoId))];
      const detailsMap = await fetchVideoDetailsBatch(uniqueVideoIds, settings.youtubeApiKey);

      const updates: Array<{ jobId: string; channelId: string; channelTitle: string }> = [];
      for (const job of jobsMissing) {
        const details = detailsMap.get(job.videoId);
        if (details?.channelId) {
          updates.push({
            jobId: job.jobId,
            channelId: details.channelId,
            channelTitle: details.channelTitle,
          });
        }
      }

      await jobStore.bulkUpdateChannelIds(updates);
      return { type: 'CHANNEL_UPDATED', payload: { backfilled: updates.length } };
    }

    default:
      return null;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureBackgroundInitialized();
  await scheduleDailyChannelRefresh();
  console.debug('[Media Summarizer] Extension installed and initialized');
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureBackgroundInitialized();
  await scheduleDailyChannelRefresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== DAILY_CHANNEL_REFRESH_ALARM) {
    return;
  }

  void ensureBackgroundInitialized()
    .then(() => storage.getSettings())
    .then((settings) => refreshAllTrackedChannels(settings))
    .catch((error) => {
      console.warn('[Media Summarizer] Daily channel refresh failed:', error);
    });
});

chrome.runtime.onMessage.addListener(
  (message: Message | { type: string; payload?: unknown }, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Media Summarizer] Message handler error:', error);
        sendResponse({ error: String(error) });
      });

    return true;
  }
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings?.newValue) {
    void scheduleDailyChannelRefresh(changes.settings.newValue as ExtensionSettings);
  }
});
