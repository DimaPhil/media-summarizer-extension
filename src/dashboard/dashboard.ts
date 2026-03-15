import type {
  Job,
  StartJobRequest,
  SummarizationResult,
  VideoInfo,
  PromptTemplate,
} from '../shared/types';
import { PLATFORM_PATTERNS } from '../shared/constants';
import './dashboard.css';

// ── Types for channel responses ──

interface ChannelWithCounts {
  channelId: string;
  title: string;
  thumbnailUrl?: string;
  uploadsPlaylistId: string;
  addedAt: number;
  lastFetchedAt?: number;
  subscribed: boolean;
  newCount: number;
  totalCount: number;
}

interface AnnotatedChannelVideo {
  videoId: string;
  channelId: string;
  title: string;
  thumbnailUrl?: string;
  publishedAt: number;
  duration?: string;
  ignored: boolean;
  discoveredAt: number;
  hasTranscription: boolean;
  isRunning: boolean;
  isNew: boolean;
}

// ── DOM elements ──

const elements = {
  // Jobs tab
  jobsList: document.getElementById('jobs-list') as HTMLElement,
  emptyState: document.getElementById('empty-state') as HTMLElement,
  detailPanel: document.getElementById('detail-panel') as HTMLElement,
  detailPlaceholder: document.getElementById('detail-placeholder') as HTMLElement,
  detailTitle: document.getElementById('detail-title') as HTMLElement,
  detailStatus: document.getElementById('detail-status') as HTMLElement,
  detailMeta: document.getElementById('detail-meta') as HTMLElement,
  detailLink: document.getElementById('detail-link') as HTMLAnchorElement,
  outputRendered: document.getElementById('output-rendered') as HTMLElement,
  outputRaw: document.getElementById('output-raw') as HTMLElement,
  editedText: document.getElementById('edited-text') as HTMLTextAreaElement,
  saveEditBtn: document.getElementById('save-edit-btn') as HTMLButtonElement,
  restartBtn: document.getElementById('restart-btn') as HTMLButtonElement,
  deleteBtn: document.getElementById('delete-btn') as HTMLButtonElement,
  clearAllBtn: document.getElementById('clear-all-btn') as HTMLButtonElement,
  viewPromptBtn: document.getElementById('view-prompt-btn') as HTMLButtonElement,
  promptSnapshot: document.getElementById('prompt-snapshot') as HTMLElement,
  toast: document.getElementById('toast') as HTMLElement,
  toastMessage: document.getElementById('toast-message') as HTMLElement,
  // Tabs
  tabJobs: document.getElementById('tab-jobs') as HTMLElement,
  tabChannels: document.getElementById('tab-channels') as HTMLElement,
  // Channels
  addChannelBtn: document.getElementById('add-channel-btn') as HTMLButtonElement,
  channelsListView: document.getElementById('channels-list-view') as HTMLElement,
  channelsList: document.getElementById('channels-list') as HTMLElement,
  channelsEmpty: document.getElementById('channels-empty') as HTMLElement,
  channelDetailView: document.getElementById('channel-detail-view') as HTMLElement,
  channelBackBtn: document.getElementById('channel-back-btn') as HTMLButtonElement,
  channelDetailAvatar: document.getElementById('channel-detail-avatar') as HTMLImageElement,
  channelDetailTitle: document.getElementById('channel-detail-title') as HTMLElement,
  channelDetailStats: document.getElementById('channel-detail-stats') as HTMLElement,
  batchPromptSelect: document.getElementById('batch-prompt-select') as HTMLSelectElement,
  batchTranscribeBtn: document.getElementById('batch-transcribe-btn') as HTMLButtonElement,
  refreshVideosBtn: document.getElementById('refresh-videos-btn') as HTMLButtonElement,
  removeChannelBtn: document.getElementById('remove-channel-btn') as HTMLButtonElement,
  subscribeChannelBtn: document.getElementById('subscribe-channel-btn') as HTMLButtonElement,
  channelVideosList: document.getElementById('channel-videos-list') as HTMLElement,
  // Modal
  addChannelModal: document.getElementById('add-channel-modal') as HTMLElement,
  channelInput: document.getElementById('channel-input') as HTMLInputElement,
  channelInputError: document.getElementById('channel-input-error') as HTMLElement,
  modalCancelBtn: document.getElementById('modal-cancel-btn') as HTMLButtonElement,
  modalAddBtn: document.getElementById('modal-add-btn') as HTMLButtonElement,
};

// ── State ──

let jobs: Job[] = [];
let selectedJobId: string | null = null;
let currentTab: 'jobs' | 'channels' = 'jobs';
let channels: ChannelWithCounts[] = [];
let selectedChannelId: string | null = null;
let channelVideos: AnnotatedChannelVideo[] = [];
let prompts: PromptTemplate[] = [];

// ── Messaging ──

async function sendMessage<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response && typeof response === 'object' && 'error' in response && response.error) {
        reject(new Error(String(response.error)));
        return;
      }

      resolve(response && 'payload' in response ? response.payload : response);
    });
  });
}

async function startJobWithFallback(request: StartJobRequest): Promise<SummarizationResult> {
  const primary = await sendMessage<SummarizationResult | null>('START_JOB', request).catch(
    () => null
  );
  if (primary) {
    return primary;
  }

  const fallback = await sendMessage<SummarizationResult | null>('SUMMARIZE', request);
  if (!fallback) {
    throw new Error('No response from background job runner');
  }

  return fallback;
}

// ── Utilities ──

function showToast(message: string, timeoutMs = 2500): void {
  elements.toastMessage.textContent = message;
  elements.toast.classList.remove('hidden');
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, timeoutMs);
}

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleString();
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleDateString();
}

function statusClass(status: Job['status']): string {
  switch (status) {
    case 'RUNNING':
      return 'status-running';
    case 'SUCCEEDED':
      return 'status-succeeded';
    case 'FAILED':
      return 'status-failed';
    default:
      return 'status-canceled';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function simpleMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

const CHANNEL_VIDEO_CAP = 100; // 2 pages × 50 results from YouTube API

function formatVideoCount(count: number, subscribed: boolean): string {
  const capped = subscribed && count >= CHANNEL_VIDEO_CAP;
  const display = capped ? `${CHANNEL_VIDEO_CAP}+` : String(count);
  return `${display} video${count !== 1 ? 's' : ''}`;
}

function ensureThumbnailUrl(job: Job): string | null {
  if (job.thumbnailUrl) return job.thumbnailUrl;
  if (job.platform === 'youtube' && job.videoId) {
    return `https://i.ytimg.com/vi/${job.videoId}/hqdefault.jpg`;
  }
  return null;
}

function findJob(jobId: string | null): Job | null {
  if (!jobId) return null;
  return jobs.find((job) => job.jobId === jobId) || null;
}

// ── Tab switching ──

function switchTab(tab: 'jobs' | 'channels'): void {
  currentTab = tab;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });

  elements.tabJobs.classList.toggle('hidden', tab !== 'jobs');
  elements.tabChannels.classList.toggle('hidden', tab !== 'channels');
  elements.clearAllBtn.classList.toggle('hidden', tab !== 'jobs');

  if (tab === 'channels') {
    void backfillThenLoadChannels();
  }
}

let backfillDone = false;

async function backfillThenLoadChannels(): Promise<void> {
  if (!backfillDone) {
    backfillDone = true;
    try {
      await sendMessage('BACKFILL_CHANNEL_IDS');
    } catch {
      // No YouTube API key or network issue — continue anyway
    }
  }
  await loadChannels();
}

// ── Jobs tab ──

function renderJobsList(): void {
  if (jobs.length === 0) {
    elements.jobsList.innerHTML = '';
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');
  elements.jobsList.innerHTML = jobs
    .map((job) => {
      const thumb = ensureThumbnailUrl(job);
      const selectedClass = selectedJobId === job.jobId ? 'job-item selected' : 'job-item';
      return `
        <button class="${selectedClass}" data-job-id="${job.jobId}" type="button">
          ${thumb ? `<img class="job-thumb" src="${thumb}" alt="thumbnail" loading="lazy">` : '<div class="job-thumb fallback">No image</div>'}
          <div class="job-item-body">
            <div class="job-item-title">${escapeHtml(job.videoTitle)}</div>
            <div class="job-item-meta">
              <span class="status-badge ${statusClass(job.status)}">${job.status}</span>
              <span>${escapeHtml(job.promptName)}</span>
              <span>${escapeHtml(job.categoryName || 'No category')}</span>
            </div>
            <div class="job-item-time">${formatDateTime(job.createdAt)}</div>
          </div>
        </button>
      `;
    })
    .join('');

  elements.jobsList.querySelectorAll('.job-item').forEach((item) => {
    item.addEventListener('click', () => {
      const jobId = (item as HTMLElement).dataset.jobId;
      if (!jobId) return;
      selectedJobId = jobId;
      renderJobsList();
      renderDetail(findJob(selectedJobId));
    });
  });
}

function renderDetail(job: Job | null): void {
  if (!job) {
    elements.detailPanel.classList.add('hidden');
    elements.detailPlaceholder.classList.remove('hidden');
    return;
  }

  elements.detailPlaceholder.classList.add('hidden');
  elements.detailPanel.classList.remove('hidden');

  elements.detailTitle.textContent = job.videoTitle;
  elements.detailStatus.className = `status-badge ${statusClass(job.status)}`;
  elements.detailStatus.textContent = job.status;
  elements.detailMeta.textContent = [
    `Prompt: ${job.promptName}`,
    `Category: ${job.categoryName || 'n/a'}`,
    `Started: ${formatDateTime(job.startedAt)}`,
    `Updated: ${formatDateTime(job.updatedAt)}`,
  ].join('  |  ');

  elements.detailLink.href = job.videoUrl;
  elements.detailLink.textContent = job.videoUrl;

  const visibleText = job.editedText || job.outputText || '';
  elements.outputRendered.innerHTML = `<p>${simpleMarkdown(visibleText)}</p>`;
  elements.outputRaw.textContent = visibleText;
  elements.editedText.value = visibleText;
  elements.promptSnapshot.textContent =
    job.promptTextSnapshot || 'No snapshot stored for this job.';

  elements.saveEditBtn.disabled = job.status === 'RUNNING';
  elements.restartBtn.disabled = job.status === 'RUNNING';
}

async function loadJobs(): Promise<void> {
  jobs = await sendMessage<Job[]>('LIST_JOBS', { limit: 1000 });
  jobs.sort((a, b) => b.createdAt - a.createdAt);

  if (!selectedJobId && jobs.length) {
    selectedJobId = jobs[0].jobId;
  }

  renderJobsList();
  renderDetail(findJob(selectedJobId));
}

async function refreshSingleJob(jobId: string): Promise<void> {
  const updated = await sendMessage<Job | null>('GET_JOB', { jobId });
  if (!updated) {
    jobs = jobs.filter((job) => job.jobId !== jobId);
    if (selectedJobId === jobId) {
      selectedJobId = jobs[0]?.jobId || null;
    }
    renderJobsList();
    renderDetail(findJob(selectedJobId));
    return;
  }

  const index = jobs.findIndex((job) => job.jobId === jobId);
  if (index === -1) {
    jobs.unshift(updated);
  } else {
    jobs[index] = updated;
  }

  jobs.sort((a, b) => b.createdAt - a.createdAt);
  renderJobsList();

  if (selectedJobId === jobId) {
    renderDetail(updated);
  }
}

async function saveEditedText(): Promise<void> {
  const job = findJob(selectedJobId);
  if (!job) return;

  const editedText = elements.editedText.value;
  const updated = await sendMessage<Job | null>('UPDATE_JOB_EDITED_TEXT', {
    jobId: job.jobId,
    editedText,
  });

  if (!updated) {
    showToast('Failed to save edit');
    return;
  }

  await refreshSingleJob(job.jobId);
  showToast('Edited text saved');
}

function buildVideoInfoFromJob(job: Job): VideoInfo {
  return {
    url: job.videoUrl,
    videoId: job.videoId,
    platform: job.platform,
    title: job.videoTitle,
    categoryId: job.categoryId,
    categoryName: job.categoryName,
    channelId: job.channelId,
    channelTitle: job.channelTitle,
  };
}

async function restartJob(): Promise<void> {
  const job = findJob(selectedJobId);
  if (!job) return;

  const request: StartJobRequest = {
    videoInfo: buildVideoInfoFromJob(job),
    promptId: job.promptId,
    forceRegenerate: true,
  };

  const result = await startJobWithFallback(request);

  if (result.jobId) {
    selectedJobId = result.jobId;
    await refreshSingleJob(result.jobId);
  }

  if (result.inProgress) {
    showToast('Job started');
    return;
  }

  if (!result.success) {
    showToast(result.error || 'Failed to start job');
  }
}

async function deleteSelectedJob(): Promise<void> {
  const job = findJob(selectedJobId);
  if (!job) return;

  const confirmed = confirm('Delete this job from history?');
  if (!confirmed) return;

  await sendMessage('DELETE_JOB', { jobId: job.jobId });
  jobs = jobs.filter((item) => item.jobId !== job.jobId);
  selectedJobId = jobs[0]?.jobId || null;
  renderJobsList();
  renderDetail(findJob(selectedJobId));
  showToast('Job deleted');
}

async function clearAllJobs(): Promise<void> {
  const confirmed = confirm('Clear all history? This cannot be undone.');
  if (!confirmed) return;

  await sendMessage('CLEAR_ALL_JOBS');
  jobs = [];
  selectedJobId = null;
  renderJobsList();
  renderDetail(null);
  showToast('All history cleared');
}

function togglePromptView(): void {
  elements.promptSnapshot.classList.toggle('hidden');
}

// ── Channels tab ──

async function loadPrompts(): Promise<void> {
  prompts = await sendMessage<PromptTemplate[]>('GET_PROMPTS');
  renderPromptSelect();
}

function renderPromptSelect(): void {
  elements.batchPromptSelect.innerHTML = prompts
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}"${p.isDefault ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    )
    .join('');
}

async function loadChannels(): Promise<void> {
  channels = await sendMessage<ChannelWithCounts[]>('LIST_CHANNELS');
  renderChannelsList();
}

function renderChannelCard(ch: ChannelWithCounts): string {
  return `
    <div class="channel-card${ch.subscribed ? '' : ' channel-card-discovered'}" data-channel-id="${escapeHtml(ch.channelId)}">
      ${ch.thumbnailUrl ? `<img class="channel-avatar" src="${escapeHtml(ch.thumbnailUrl)}" alt="">` : '<div class="channel-avatar"></div>'}
      <div class="channel-card-body">
        <div class="channel-card-title">${escapeHtml(ch.title)}</div>
        <div class="channel-card-meta">
          <span>${formatVideoCount(ch.totalCount, ch.subscribed)}</span>
          ${ch.newCount > 0 ? `<span class="new-badge">${ch.newCount} new</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderChannelsList(): void {
  if (channels.length === 0) {
    elements.channelsList.innerHTML = '';
    elements.channelsEmpty.classList.remove('hidden');
    return;
  }

  elements.channelsEmpty.classList.add('hidden');

  const subscribed = channels.filter((ch) => ch.subscribed);
  const discovered = channels.filter((ch) => !ch.subscribed);

  let html = '';

  if (subscribed.length > 0) {
    html += '<div class="channels-section-label">Subscribed</div>';
    html += `<div class="channels-grid">${subscribed.map(renderChannelCard).join('')}</div>`;
  }

  if (discovered.length > 0) {
    html += '<div class="channels-section-label channels-section-label-muted">From History</div>';
    html += `<div class="channels-grid">${discovered.map(renderChannelCard).join('')}</div>`;
  }

  elements.channelsList.innerHTML = html;

  elements.channelsList.querySelectorAll('.channel-card').forEach((card) => {
    card.addEventListener('click', () => {
      const channelId = (card as HTMLElement).dataset.channelId;
      if (channelId) {
        void openChannelDetail(channelId);
      }
    });
  });
}

async function openChannelDetail(channelId: string): Promise<void> {
  selectedChannelId = channelId;
  elements.channelsListView.classList.add('hidden');
  elements.channelDetailView.classList.remove('hidden');

  const channel = channels.find((c) => c.channelId === channelId);
  if (channel) {
    elements.channelDetailTitle.textContent = channel.title;
    elements.channelDetailStats.textContent = formatVideoCount(
      channel.totalCount,
      channel.subscribed
    );
    if (channel.thumbnailUrl) {
      elements.channelDetailAvatar.src = channel.thumbnailUrl;
      elements.channelDetailAvatar.classList.remove('hidden');
    } else {
      elements.channelDetailAvatar.classList.add('hidden');
    }

    // Toggle buttons based on subscription state
    const subscribed = channel.subscribed;
    elements.batchPromptSelect.classList.toggle('hidden', !subscribed);
    elements.batchTranscribeBtn.classList.toggle('hidden', !subscribed);
    elements.refreshVideosBtn.classList.toggle('hidden', !subscribed);
    elements.removeChannelBtn.classList.toggle('hidden', !subscribed);
    elements.subscribeChannelBtn.classList.toggle('hidden', subscribed);
  }

  await loadChannelVideos(channelId);
}

function closeChannelDetail(): void {
  selectedChannelId = null;
  elements.channelDetailView.classList.add('hidden');
  elements.channelsListView.classList.remove('hidden');
  void loadChannels();
}

async function loadChannelVideos(channelId: string): Promise<void> {
  channelVideos = await sendMessage<AnnotatedChannelVideo[]>('LIST_CHANNEL_VIDEOS', { channelId });
  renderChannelVideos();
}

function renderChannelVideos(): void {
  if (channelVideos.length === 0) {
    elements.channelVideosList.innerHTML =
      '<div class="empty-state">No videos found for this channel.</div>';
    return;
  }

  elements.channelVideosList.innerHTML = channelVideos
    .map((v) => {
      let stateClass = '';
      let statusLabel = '';
      if (v.hasTranscription) {
        stateClass = 'cv-transcribed';
        statusLabel = '<span class="status-badge status-succeeded">Transcribed</span>';
      } else if (v.isRunning) {
        stateClass = 'cv-running';
        statusLabel = '<span class="status-badge status-running">Running</span>';
      } else if (v.ignored) {
        stateClass = 'cv-ignored';
        statusLabel = '<span class="status-badge status-canceled">Ignored</span>';
      } else if (v.isNew) {
        stateClass = 'cv-new';
        statusLabel = '<span class="new-badge">New</span>';
      }

      const thumb = v.thumbnailUrl
        ? `<img class="cv-thumb" src="${escapeHtml(v.thumbnailUrl)}" alt="" loading="lazy">`
        : '';

      const actionBtns: string[] = [];
      if (v.isRunning) {
        // No action buttons while running
      } else if (v.hasTranscription) {
        actionBtns.push(
          `<button class="btn btn-primary btn-sm cv-view-job-btn" data-video-id="${v.videoId}" type="button">View Result</button>`
        );
        actionBtns.push(
          `<a class="btn btn-secondary btn-sm" href="https://www.youtube.com/watch?v=${v.videoId}" target="_blank" rel="noopener">Open Video</a>`
        );
      } else if (v.ignored) {
        actionBtns.push(
          `<button class="btn btn-secondary btn-sm cv-unignore-btn" data-video-id="${v.videoId}" type="button">Un-ignore</button>`
        );
        actionBtns.push(
          `<button class="btn btn-primary btn-sm cv-transcribe-btn" data-video-id="${v.videoId}" type="button">Transcribe</button>`
        );
      } else {
        actionBtns.push(
          `<button class="btn btn-primary btn-sm cv-transcribe-btn" data-video-id="${v.videoId}" type="button">Transcribe</button>`
        );
        actionBtns.push(
          `<button class="btn btn-secondary btn-sm cv-ignore-btn" data-video-id="${v.videoId}" type="button">Ignore</button>`
        );
      }

      return `
        <div class="cv-item ${stateClass}">
          ${thumb}
          <div class="cv-body">
            <div class="cv-title">${escapeHtml(v.title)}</div>
            <div class="cv-meta">
              ${statusLabel}
              <span>${formatDate(v.publishedAt)}</span>
              ${v.duration ? `<span>${escapeHtml(v.duration)}</span>` : ''}
            </div>
          </div>
          <div class="cv-actions">
            ${actionBtns.join('')}
          </div>
        </div>
      `;
    })
    .join('');

  // Bind action buttons
  elements.channelVideosList.querySelectorAll('.cv-transcribe-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoId = (btn as HTMLElement).dataset.videoId;
      if (videoId) void transcribeSingleVideo(videoId);
    });
  });

  elements.channelVideosList.querySelectorAll('.cv-view-job-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoId = (btn as HTMLElement).dataset.videoId;
      if (videoId) void viewJobForVideo(videoId);
    });
  });

  elements.channelVideosList.querySelectorAll('.cv-ignore-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoId = (btn as HTMLElement).dataset.videoId;
      if (videoId) void toggleIgnore(videoId, true);
    });
  });

  elements.channelVideosList.querySelectorAll('.cv-unignore-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const videoId = (btn as HTMLElement).dataset.videoId;
      if (videoId) void toggleIgnore(videoId, false);
    });
  });
}

async function viewJobForVideo(videoId: string): Promise<void> {
  // Find the latest succeeded job for this video
  const matchingJob = jobs.find((j) => j.videoId === videoId && j.status === 'SUCCEEDED');
  if (matchingJob) {
    selectedJobId = matchingJob.jobId;
    switchTab('jobs');
    renderJobsList();
    renderDetail(matchingJob);
    return;
  }
  // If not loaded yet, reload jobs and try again
  await loadJobs();
  const job = jobs.find((j) => j.videoId === videoId && j.status === 'SUCCEEDED');
  if (job) {
    selectedJobId = job.jobId;
    switchTab('jobs');
    renderJobsList();
    renderDetail(job);
  } else {
    showToast('Job not found');
  }
}

async function transcribeSingleVideo(videoId: string): Promise<void> {
  const video = channelVideos.find((v) => v.videoId === videoId);
  if (!video) return;

  const promptId = elements.batchPromptSelect.value;
  const channel = channels.find((c) => c.channelId === video.channelId);

  const videoInfo: VideoInfo = {
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    videoId: video.videoId,
    platform: 'youtube',
    title: video.title,
    duration: video.duration,
    channelId: video.channelId,
    channelTitle: channel?.title,
  };

  const result = await startJobWithFallback({
    videoInfo,
    promptId,
    forceRegenerate: false,
  });

  if (result.inProgress || result.success) {
    showToast('Job started');
  } else {
    showToast(result.error || 'Failed to start job');
  }
}

async function toggleIgnore(videoId: string, ignored: boolean): Promise<void> {
  await sendMessage('IGNORE_VIDEO', { videoId, ignored });
  if (selectedChannelId) {
    await loadChannelVideos(selectedChannelId);
  }
  showToast(ignored ? 'Video ignored' : 'Video un-ignored');
}

async function batchTranscribe(): Promise<void> {
  if (!selectedChannelId) return;

  const promptId = elements.batchPromptSelect.value;
  const newCount = channelVideos.filter((v) => v.isNew).length;

  if (newCount === 0) {
    showToast('No new videos to transcribe');
    return;
  }

  const confirmed = confirm(`Start transcription for ${newCount} new video(s)?`);
  if (!confirmed) return;

  elements.batchTranscribeBtn.disabled = true;
  elements.batchTranscribeBtn.textContent = 'Starting...';

  try {
    await sendMessage('BATCH_TRANSCRIBE', {
      channelId: selectedChannelId,
      promptId,
    });
    showToast(`Queued ${newCount} transcription(s)`);
  } catch (error) {
    showToast('Batch transcribe failed: ' + String(error));
  } finally {
    elements.batchTranscribeBtn.disabled = false;
    elements.batchTranscribeBtn.textContent = 'Transcribe All New';
  }
}

async function refreshChannelVideos(): Promise<void> {
  if (!selectedChannelId) return;

  elements.refreshVideosBtn.disabled = true;
  elements.refreshVideosBtn.textContent = 'Refreshing...';

  try {
    await sendMessage('FETCH_CHANNEL_VIDEOS', { channelId: selectedChannelId });
    await loadChannelVideos(selectedChannelId);
    showToast('Videos refreshed');
  } catch (error) {
    showToast('Refresh failed: ' + String(error));
  } finally {
    elements.refreshVideosBtn.disabled = false;
    elements.refreshVideosBtn.textContent = 'Refresh Videos';
  }
}

async function subscribeChannel(): Promise<void> {
  if (!selectedChannelId) return;

  elements.subscribeChannelBtn.disabled = true;
  elements.subscribeChannelBtn.textContent = 'Subscribing...';

  try {
    await sendMessage('ADD_CHANNEL', { channelId: selectedChannelId });
    showToast('Channel subscribed');
    // Reload channels list and reopen detail with full capabilities
    await loadChannels();
    await openChannelDetail(selectedChannelId);
  } catch (error) {
    showToast('Subscribe failed: ' + String(error));
  } finally {
    elements.subscribeChannelBtn.disabled = false;
    elements.subscribeChannelBtn.textContent = 'Subscribe';
  }
}

async function removeChannel(): Promise<void> {
  if (!selectedChannelId) return;

  const confirmed = confirm('Remove this channel? Jobs will be kept in history.');
  if (!confirmed) return;

  await sendMessage('REMOVE_CHANNEL', { channelId: selectedChannelId });
  showToast('Channel removed');
  closeChannelDetail();
}

// ── Add channel modal ──

function openAddChannelModal(): void {
  elements.channelInput.value = '';
  elements.channelInputError.classList.add('hidden');
  elements.addChannelModal.classList.remove('hidden');
  elements.channelInput.focus();
}

function closeAddChannelModal(): void {
  elements.addChannelModal.classList.add('hidden');
}

function parseChannelInput(input: string): { videoId?: string; channelId?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Direct channel ID (UC...)
  if (/^UC[a-zA-Z0-9_-]{22}$/.test(trimmed)) {
    return { channelId: trimmed };
  }

  // Try to extract videoId from URL using PLATFORM_PATTERNS
  for (const pattern of PLATFORM_PATTERNS.youtube) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return { videoId: match[1] };
    }
  }

  // Check if it's a channel URL pattern
  const channelUrlMatch = trimmed.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/);
  if (channelUrlMatch?.[1]) {
    return { channelId: channelUrlMatch[1] };
  }

  return null;
}

async function addChannel(): Promise<void> {
  const parsed = parseChannelInput(elements.channelInput.value);
  if (!parsed) {
    elements.channelInputError.textContent =
      'Please enter a valid YouTube video URL or channel ID (UC...)';
    elements.channelInputError.classList.remove('hidden');
    return;
  }

  elements.modalAddBtn.disabled = true;
  elements.modalAddBtn.textContent = 'Adding...';
  elements.channelInputError.classList.add('hidden');

  try {
    await sendMessage('ADD_CHANNEL', parsed);
    closeAddChannelModal();
    await loadChannels();
    showToast('Channel added');
  } catch (error) {
    elements.channelInputError.textContent = String(error);
    elements.channelInputError.classList.remove('hidden');
  } finally {
    elements.modalAddBtn.disabled = false;
    elements.modalAddBtn.textContent = 'Add';
  }
}

// ── Event binding ──

function bindEvents(): void {
  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab as 'jobs' | 'channels';
      if (tab) switchTab(tab);
    });
  });

  // Jobs tab
  elements.saveEditBtn.addEventListener('click', () => {
    void saveEditedText();
  });

  elements.restartBtn.addEventListener('click', () => {
    void restartJob();
  });

  elements.deleteBtn.addEventListener('click', () => {
    void deleteSelectedJob();
  });

  elements.clearAllBtn.addEventListener('click', () => {
    void clearAllJobs();
  });

  elements.viewPromptBtn.addEventListener('click', togglePromptView);

  // Channels tab
  elements.addChannelBtn.addEventListener('click', openAddChannelModal);
  elements.channelBackBtn.addEventListener('click', closeChannelDetail);
  elements.batchTranscribeBtn.addEventListener('click', () => {
    void batchTranscribe();
  });
  elements.refreshVideosBtn.addEventListener('click', () => {
    void refreshChannelVideos();
  });
  elements.removeChannelBtn.addEventListener('click', () => {
    void removeChannel();
  });
  elements.subscribeChannelBtn.addEventListener('click', () => {
    void subscribeChannel();
  });

  // Modal
  elements.modalCancelBtn.addEventListener('click', closeAddChannelModal);
  elements.modalAddBtn.addEventListener('click', () => {
    void addChannel();
  });
  elements.channelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addChannel();
    if (e.key === 'Escape') closeAddChannelModal();
  });
  elements.addChannelModal.addEventListener('click', (e) => {
    if (e.target === elements.addChannelModal) closeAddChannelModal();
  });

  // Real-time updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'JOB_UPDATED') {
      const { jobId } = message.payload || {};
      if (jobId) {
        void refreshSingleJob(jobId);
        // Also refresh channel videos if viewing a channel
        if (currentTab === 'channels' && selectedChannelId) {
          void loadChannelVideos(selectedChannelId);
        }
      }
    }

    if (message.type === 'CHANNEL_UPDATED') {
      if (currentTab === 'channels') {
        void loadChannels();
        const { channelId } = message.payload || {};
        if (channelId && selectedChannelId === channelId) {
          void loadChannelVideos(channelId);
        }
      }
    }
  });
}

// ── Initialize ──

async function initialize(): Promise<void> {
  bindEvents();
  await Promise.all([loadJobs(), loadPrompts()]);
}

document.addEventListener('DOMContentLoaded', () => {
  void initialize();
});
