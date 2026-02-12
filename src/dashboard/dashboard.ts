import type { Job, StartJobRequest, SummarizationResult, VideoInfo } from '../shared/types';
import './dashboard.css';

const elements = {
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
};

let jobs: Job[] = [];
let selectedJobId: string | null = null;

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

      resolve(response?.payload ?? response);
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

function bindEvents(): void {
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'JOB_UPDATED') {
      return;
    }

    const { jobId } = message.payload || {};
    if (!jobId) {
      return;
    }

    void refreshSingleJob(jobId);
  });
}

async function initialize(): Promise<void> {
  bindEvents();
  await loadJobs();
}

document.addEventListener('DOMContentLoaded', () => {
  void initialize();
});
