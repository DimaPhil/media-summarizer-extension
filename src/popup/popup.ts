import type {
  VideoInfo,
  PromptTemplate,
  ExtensionSettings,
  SummarizationResult,
  InProgressStatus,
} from '../shared/types';
import { CATEGORY_TO_PROMPT } from '../shared/constants';
import './popup.css';

const elements = {
  settingsBtn: document.getElementById('settings-btn') as HTMLButtonElement,
  noApiKey: document.getElementById('no-api-key') as HTMLElement,
  openSettings: document.getElementById('open-settings') as HTMLButtonElement,
  noVideo: document.getElementById('no-video') as HTMLElement,
  videoInfo: document.getElementById('video-info') as HTMLElement,
  videoTitle: document.getElementById('video-title') as HTMLElement,
  videoPlatform: document.getElementById('video-platform') as HTMLElement,
  videoDuration: document.getElementById('video-duration') as HTMLElement,
  videoCategory: document.getElementById('video-category') as HTMLElement,
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
};

let currentVideoInfo: VideoInfo | null = null;
let currentSettings: ExtensionSettings | null = null;
let currentPrompts: PromptTemplate[] = [];
let isLoading = false;

async function sendMessage<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      resolve(response?.payload ?? response);
    });
  });
}

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
  elements.videoPlatform.textContent = videoInfo.platform.charAt(0).toUpperCase() + videoInfo.platform.slice(1);

  if (videoInfo.duration) {
    elements.videoDuration.textContent = videoInfo.duration;
  } else {
    elements.videoDuration.textContent = '';
  }

  if (videoInfo.categoryName) {
    elements.videoCategory.textContent = videoInfo.categoryName;
  } else {
    elements.videoCategory.textContent = '';
  }

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
  elements.summaryContent.innerHTML = `<p>${simpleMarkdown(summary)}</p>`;
}

function showError(message: string): void {
  hideAllSections();
  showSection(elements.videoInfo);
  showSection(elements.errorSection);
  elements.errorMessage.textContent = message;
}

async function initialize(): Promise<void> {
  currentSettings = await sendMessage<ExtensionSettings>('GET_SETTINGS');
  currentPrompts = await sendMessage<PromptTemplate[]>('GET_PROMPTS');

  if (!currentSettings?.geminiApiKey) {
    hideAllSections();
    showSection(elements.noApiKey);
    return;
  }

  elements.autoDetect.checked = currentSettings.autoDetectCategory;
  renderPrompts(currentPrompts, currentSettings.defaultPromptId);

  currentVideoInfo = await sendMessage<VideoInfo | null>('GET_VIDEO_INFO');

  hideAllSections();

  if (!currentVideoInfo) {
    showSection(elements.noVideo);
    return;
  }

  renderVideoInfo(currentVideoInfo);
  showSection(elements.videoInfo);

  // Check if summarization is already in progress for this video
  const inProgressStatus = await sendMessage<InProgressStatus>('CHECK_IN_PROGRESS', {
    videoId: currentVideoInfo.videoId,
    platform: currentVideoInfo.platform,
  });

  if (inProgressStatus?.inProgress) {
    // Show loading state - summarization is already running
    setLoading(true);
    elements.cachedBadge.classList.add('hidden');

    // If we have the prompt ID, select it in the dropdown
    if (inProgressStatus.promptId) {
      elements.promptSelect.value = inProgressStatus.promptId;
    }
  }
}

async function summarize(forceRegenerate = false): Promise<void> {
  if (!currentVideoInfo || isLoading) return;

  setLoading(true);
  hideAllSections();
  showSection(elements.videoInfo);
  elements.cachedBadge.classList.add('hidden');
  elements.summaryContent.setAttribute('data-raw', '');

  const promptId = elements.promptSelect.value;

  try {
    const result = await sendMessage<SummarizationResult>('SUMMARIZE', {
      videoInfo: currentVideoInfo,
      promptId,
      forceRegenerate,
    });

    // If already in progress, keep showing loading (streaming will update UI)
    if (result.inProgress && !result.summary) {
      // Summarization started or already running - wait for stream updates
      return;
    }

    if (result.success && result.summary) {
      renderSummary(result.summary);
      showSection(elements.summarySection);

      // Show cached badge if result came from cache
      if (result.cached) {
        elements.cachedBadge.classList.remove('hidden');
      } else {
        elements.cachedBadge.classList.add('hidden');
      }
      setLoading(false);
    } else if (!result.inProgress) {
      showError(result.error || 'Failed to summarize video');
      setLoading(false);
    }
  } catch (error) {
    showError(String(error));
    setLoading(false);
  }
}

async function regenerate(): Promise<void> {
  await summarize(true);
}

function copyToClipboard(): void {
  const text = elements.summaryContent.innerText;
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SUMMARIZE_STREAM') {
    const { chunk, done } = message.payload;

    if (!elements.summarySection.classList.contains('hidden') || chunk) {
      showSection(elements.summarySection);
      // Streaming responses are never cached (they're fresh)
      elements.cachedBadge.classList.add('hidden');
    }

    if (chunk) {
      const currentText = elements.summaryContent.getAttribute('data-raw') || '';
      const newText = currentText + chunk;
      elements.summaryContent.setAttribute('data-raw', newText);
      renderSummary(newText);
    }

    if (done) {
      setLoading(false);
    }
  }

  // Handle errors that occur during streaming
  if (message.type === 'SUMMARIZE_RESPONSE') {
    const result = message.payload as SummarizationResult;
    if (!result.success && result.error) {
      showError(result.error);
      setLoading(false);
    }
  }
});

elements.settingsBtn.addEventListener('click', openOptions);
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
