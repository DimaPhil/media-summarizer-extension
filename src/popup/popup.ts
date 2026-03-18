import type {
  VideoInfo,
  PromptTemplate,
  ExtensionSettings,
  CachedSummary,
  Job,
  SummarizationResult,
} from '../shared/types';
import { CATEGORY_TO_PROMPT } from '../shared/constants';
import { sendRuntimeMessage, startJobWithRuntimeFallback } from '../shared/runtime';
import './popup.css';

const elements = {
  settingsBtn: document.getElementById('settings-btn') as HTMLButtonElement,
  dashboardBtn: document.getElementById('dashboard-btn') as HTMLButtonElement,
  noApiKey: document.getElementById('no-api-key') as HTMLElement,
  openSettings: document.getElementById('open-settings') as HTMLButtonElement,
  noVideo: document.getElementById('no-video') as HTMLElement,
  videoInfo: document.getElementById('video-info') as HTMLElement,
  videoTitle: document.getElementById('video-title') as HTMLElement,
  videoPlatform: document.getElementById('video-platform') as HTMLElement,
  videoDuration: document.getElementById('video-duration') as HTMLElement,
  videoCategory: document.getElementById('video-category') as HTMLElement,
  jobStatus: document.getElementById('job-status') as HTMLElement,
  promptSelect: document.getElementById('prompt-select') as HTMLSelectElement,
  autoDetect: document.getElementById('auto-detect') as HTMLInputElement,
  summarizeBtn: document.getElementById('summarize-btn') as HTMLButtonElement,
  summarySection: document.getElementById('summary-section') as HTMLElement,
  summaryContent: document.getElementById('summary-content') as HTMLElement,
  cachedBadge: document.getElementById('cached-badge') as HTMLElement,
  copyBtn: document.getElementById('copy-btn') as HTMLButtonElement,
  regenerateBtn: document.getElementById('regenerate-btn') as HTMLButtonElement,
  errorSection: document.getElementById('error-section') as HTMLElement,
  errorMessage: document.getElementById('error-message') as HTMLElement,
  errorRetryBtn: document.getElementById('error-retry-btn') as HTMLButtonElement,
  cancelBtn: document.getElementById('cancel-btn') as HTMLButtonElement,
};

let currentVideoInfo: VideoInfo | null = null;
let currentSettings: ExtensionSettings | null = null;
let currentPrompts: PromptTemplate[] = [];
let isLoading = false;
let currentJobId: string | null = null;

function hideAllSections(): void {
  elements.noApiKey.classList.add('hidden');
  elements.noVideo.classList.add('hidden');
  elements.videoInfo.classList.add('hidden');
  elements.summarySection.classList.add('hidden');
  elements.errorSection.classList.add('hidden');
}

function showSection(section: HTMLElement): void {
  section.classList.remove('hidden');
}

function setLoading(loading: boolean): void {
  isLoading = loading;
  elements.summarizeBtn.disabled = loading;
  elements.regenerateBtn.disabled = loading;

  const btnText = elements.summarizeBtn.querySelector('.btn-text') as HTMLElement;
  const btnLoading = elements.summarizeBtn.querySelector('.btn-loading') as HTMLElement;

  if (loading) {
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
  } else {
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
}

function setJobStatus(
  text: string,
  status: 'idle' | 'running' | 'success' | 'failed' = 'idle'
): void {
  elements.jobStatus.textContent = text;
  elements.jobStatus.classList.remove('hidden', 'running', 'success', 'failed');

  if (!text) {
    elements.jobStatus.classList.add('hidden');
    return;
  }

  if (status !== 'idle') {
    elements.jobStatus.classList.add(status);
  }
}

function renderPrompts(prompts: PromptTemplate[], selectedId?: string): void {
  elements.promptSelect.innerHTML = prompts
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  if (selectedId) {
    elements.promptSelect.value = selectedId;
  }
}

function detectPromptForVideo(videoInfo: VideoInfo): string {
  if (videoInfo.categoryId && CATEGORY_TO_PROMPT[videoInfo.categoryId]) {
    return CATEGORY_TO_PROMPT[videoInfo.categoryId];
  }
  return currentSettings?.defaultPromptId || 'general';
}

function renderVideoInfo(videoInfo: VideoInfo): void {
  elements.videoTitle.textContent = videoInfo.title;
  elements.videoPlatform.textContent =
    videoInfo.platform.charAt(0).toUpperCase() + videoInfo.platform.slice(1);

  elements.videoDuration.textContent = videoInfo.duration || '';
  elements.videoCategory.textContent = videoInfo.categoryName || '';

  if (elements.autoDetect.checked && currentSettings?.autoDetectCategory) {
    const detectedPromptId = detectPromptForVideo(videoInfo);
    elements.promptSelect.value = detectedPromptId;
  }
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

function renderSummary(summary: string): void {
  elements.summaryContent.setAttribute('data-raw', summary);
  elements.summaryContent.innerHTML = `<p>${simpleMarkdown(summary)}</p>`;
}

function showError(message: string): void {
  hideAllSections();
  showSection(elements.videoInfo);
  showSection(elements.errorSection);
  elements.errorMessage.textContent = message;
}

function buildUnexpectedResultError(result: unknown): string {
  try {
    return `Unexpected background response: ${JSON.stringify(result).slice(0, 220)}`;
  } catch {
    return 'Unexpected background response';
  }
}

async function loadJob(jobId: string): Promise<Job | null> {
  const job = await sendRuntimeMessage<Job | null>('GET_JOB', { jobId });
  return job;
}

function applyJobState(job: Job): void {
  currentJobId = job.jobId;

  if (job.promptId) {
    elements.promptSelect.value = job.promptId;
  }

  if (job.outputText) {
    renderSummary(job.editedText || job.outputText);
    showSection(elements.summarySection);
    elements.cachedBadge.classList.add('hidden');
  }

  if (job.status === 'RUNNING') {
    setLoading(true);
    setJobStatus('In progress...');
    elements.promptSelect.disabled = true;
    elements.cancelBtn.classList.remove('hidden');
    return;
  }

  elements.promptSelect.disabled = false;
  elements.cancelBtn.classList.add('hidden');

  if (job.status === 'SUCCEEDED') {
    setLoading(false);
    setJobStatus('Completed', 'success');
    if (job.outputText) {
      renderSummary(job.editedText || job.outputText);
      showSection(elements.summarySection);
    }
    return;
  }

  if (job.status === 'FAILED') {
    setLoading(false);
    setJobStatus('Failed', 'failed');
    showError(job.errorMessage || 'Job failed');
    return;
  }

  setLoading(false);
  setJobStatus('Canceled');
}

async function restoreLatestVideoState(): Promise<boolean> {
  if (!currentVideoInfo) {
    return false;
  }

  const activeJob = await sendRuntimeMessage<Job | null>('GET_ACTIVE_JOB', {
    videoId: currentVideoInfo.videoId,
    platform: currentVideoInfo.platform,
  });

  if (activeJob && activeJob.status === 'RUNNING') {
    applyJobState(activeJob);
    return true;
  }

  const jobs = await sendRuntimeMessage<Job[]>('LIST_JOBS', { limit: 100 });
  const latestFinishedForVideo = jobs.find(
    (job) =>
      job.videoId === currentVideoInfo?.videoId &&
      job.platform === currentVideoInfo?.platform &&
      job.status === 'SUCCEEDED'
  );

  if (latestFinishedForVideo) {
    applyJobState(latestFinishedForVideo);
    return true;
  }

  return false;
}

async function initialize(): Promise<void> {
  currentSettings = await sendRuntimeMessage<ExtensionSettings>('GET_SETTINGS');
  currentPrompts = await sendRuntimeMessage<PromptTemplate[]>('GET_PROMPTS');

  if (!currentSettings?.geminiApiKey) {
    hideAllSections();
    showSection(elements.noApiKey);
    return;
  }

  elements.autoDetect.checked = currentSettings.autoDetectCategory;
  renderPrompts(currentPrompts, currentSettings.defaultPromptId);

  currentVideoInfo = await sendRuntimeMessage<VideoInfo | null>('GET_VIDEO_INFO');

  hideAllSections();

  if (!currentVideoInfo) {
    showSection(elements.noVideo);
    return;
  }

  renderVideoInfo(currentVideoInfo);
  showSection(elements.videoInfo);

  const restored = await restoreLatestVideoState();
  if (restored) {
    return;
  }

  const cachedSummary = await sendRuntimeMessage<CachedSummary | null>('GET_CACHED_SUMMARY', {
    videoId: currentVideoInfo.videoId,
    platform: currentVideoInfo.platform,
  });

  if (cachedSummary) {
    elements.promptSelect.value = cachedSummary.promptId;
    renderSummary(cachedSummary.summary);
    showSection(elements.summarySection);
    elements.cachedBadge.classList.remove('hidden');
    setJobStatus('Loaded from cache');
  } else {
    setJobStatus('Ready');
  }
}

async function summarize(forceRegenerate = false): Promise<void> {
  if (!currentVideoInfo || isLoading) return;

  setLoading(true);
  setJobStatus('Starting...', 'running');
  hideAllSections();
  showSection(elements.videoInfo);
  elements.cachedBadge.classList.add('hidden');

  const request = {
    videoInfo: currentVideoInfo,
    promptId: elements.promptSelect.value,
    forceRegenerate,
  };

  try {
    const result = await startJobWithRuntimeFallback(request);

    if (result.cached && result.summary) {
      renderSummary(result.summary);
      showSection(elements.summarySection);
      elements.cachedBadge.classList.remove('hidden');
      setJobStatus('Loaded from cache');
      setLoading(false);
      return;
    }

    if (result.inProgress) {
      if (result.jobId) {
        const job = await loadJob(result.jobId);
        if (job) {
          applyJobState(job);
          return;
        }
      }

      // Compatibility path for older background handlers that report inProgress without jobId.
      setLoading(true);
      elements.promptSelect.disabled = true;
      setJobStatus('In progress...', 'running');
      return;
    }

    if (result.success && result.summary) {
      renderSummary(result.summary);
      showSection(elements.summarySection);
      setJobStatus('Completed', 'success');
      setLoading(false);
      return;
    }

    showError(result.error || buildUnexpectedResultError(result));
    setLoading(false);
  } catch (error) {
    showError(String(error));
    setLoading(false);
  }
}

async function regenerate(): Promise<void> {
  await summarize(true);
}

function copyToClipboard(): void {
  const text =
    elements.summaryContent.getAttribute('data-raw') || elements.summaryContent.innerText;
  navigator.clipboard.writeText(text).then(() => {
    const originalTitle = elements.copyBtn.title;
    elements.copyBtn.title = 'Copied!';
    setTimeout(() => {
      elements.copyBtn.title = originalTitle;
    }, 2000);
  });
}

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}

function openDashboard(): void {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'JOB_UPDATED') {
    const { jobId } = message.payload || {};
    if (!jobId || !currentJobId || jobId !== currentJobId) {
      return;
    }

    void loadJob(jobId).then((job) => {
      if (!job) return;
      applyJobState(job);
    });
  }

  if (message.type === 'SUMMARIZE_RESPONSE') {
    const result = message.payload as SummarizationResult | null;
    if (!result) {
      return;
    }
    if (result.jobId && currentJobId && result.jobId !== currentJobId) {
      return;
    }

    if (!result.success && result.error) {
      setLoading(false);
      showError(result.error);
      setJobStatus('Failed', 'failed');
    }
  }
});

async function cancelJob(): Promise<void> {
  if (!currentJobId) return;
  elements.cancelBtn.disabled = true;
  try {
    await sendRuntimeMessage('CANCEL_JOB', { jobId: currentJobId });
    setLoading(false);
    setJobStatus('Canceled');
    elements.cancelBtn.classList.add('hidden');
    elements.promptSelect.disabled = false;
  } finally {
    elements.cancelBtn.disabled = false;
  }
}

elements.cancelBtn.addEventListener('click', () => {
  void cancelJob();
});
elements.settingsBtn.addEventListener('click', openOptions);
if (elements.dashboardBtn) {
  elements.dashboardBtn.addEventListener('click', openDashboard);
}
elements.openSettings.addEventListener('click', openOptions);
elements.summarizeBtn.addEventListener('click', () => summarize(false));
elements.copyBtn.addEventListener('click', copyToClipboard);
elements.regenerateBtn.addEventListener('click', regenerate);
elements.errorRetryBtn.addEventListener('click', () => summarize(false));

elements.autoDetect.addEventListener('change', () => {
  if (elements.autoDetect.checked && currentVideoInfo) {
    const detectedPromptId = detectPromptForVideo(currentVideoInfo);
    elements.promptSelect.value = detectedPromptId;
  }
});

document.addEventListener('DOMContentLoaded', initialize);
