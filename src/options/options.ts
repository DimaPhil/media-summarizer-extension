import type { ExtensionSettings, PromptTemplate, StorageData } from '../shared/types';
import { DEFAULT_SETTINGS, GEMINI_MODELS } from '../shared/constants';
import { DEFAULT_PROMPTS } from '../lib/prompts';
import { sendRuntimeMessage } from '../shared/runtime';
import './options.css';

const elements = {
  geminiApiKey: document.getElementById('gemini-api-key') as HTMLInputElement,
  toggleGeminiKey: document.getElementById('toggle-gemini-key') as HTMLButtonElement,
  testGeminiKey: document.getElementById('test-gemini-key') as HTMLButtonElement,
  geminiTestResult: document.getElementById('gemini-test-result') as HTMLElement,
  youtubeApiKey: document.getElementById('youtube-api-key') as HTMLInputElement,
  toggleYoutubeKey: document.getElementById('toggle-youtube-key') as HTMLButtonElement,
  testYoutubeKey: document.getElementById('test-youtube-key') as HTMLButtonElement,
  youtubeTestResult: document.getElementById('youtube-test-result') as HTMLElement,
  geminiModel: document.getElementById('gemini-model') as HTMLSelectElement,
  defaultPrompt: document.getElementById('default-prompt') as HTMLSelectElement,
  autoDetectCategory: document.getElementById('auto-detect-category') as HTMLInputElement,
  autoRefreshChannelsDaily: document.getElementById(
    'auto-refresh-channels-daily'
  ) as HTMLInputElement,
  streamResponse: document.getElementById('stream-response') as HTMLInputElement,
  timeoutMinutes: document.getElementById('timeout-minutes') as HTMLInputElement,
  promptsList: document.getElementById('prompts-list') as HTMLElement,
  addPrompt: document.getElementById('add-prompt') as HTMLButtonElement,
  resetDefaults: document.getElementById('reset-defaults') as HTMLButtonElement,
  saveSettings: document.getElementById('save-settings') as HTMLButtonElement,
  promptModal: document.getElementById('prompt-modal') as HTMLElement,
  modalTitle: document.getElementById('modal-title') as HTMLElement,
  closeModal: document.getElementById('close-modal') as HTMLButtonElement,
  promptName: document.getElementById('prompt-name') as HTMLInputElement,
  promptText: document.getElementById('prompt-text') as HTMLTextAreaElement,
  cancelPrompt: document.getElementById('cancel-prompt') as HTMLButtonElement,
  savePrompt: document.getElementById('save-prompt') as HTMLButtonElement,
  toast: document.getElementById('toast') as HTMLElement,
  toastMessage: document.getElementById('toast-message') as HTMLElement,
};

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let currentPrompts: PromptTemplate[] = [...DEFAULT_PROMPTS];
let editingPromptId: string | null = null;

function showToast(message: string, duration = 3000): void {
  elements.toastMessage.textContent = message;
  elements.toast.classList.remove('hidden');
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, duration);
}

function togglePasswordVisibility(input: HTMLInputElement): void {
  input.type = input.type === 'password' ? 'text' : 'password';
}

function renderPrompts(): void {
  elements.promptsList.innerHTML = currentPrompts
    .map(
      (prompt) => `
      <div class="prompt-item" data-id="${prompt.id}">
        <div class="prompt-info">
          <div class="prompt-name">
            ${prompt.name}
            ${prompt.isDefault ? '<span class="prompt-badge">Default</span>' : ''}
          </div>
          <div class="prompt-preview">${prompt.prompt.substring(0, 100)}...</div>
        </div>
        <div class="prompt-actions">
          <button type="button" class="btn btn-icon edit-prompt" data-id="${prompt.id}" title="Edit">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          ${
            !prompt.isDefault
              ? `
            <button type="button" class="btn btn-icon delete-prompt" data-id="${prompt.id}" title="Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          `
              : ''
          }
        </div>
      </div>
    `
    )
    .join('');

  elements.promptsList.querySelectorAll('.edit-prompt').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.id!;
      openEditModal(id);
    });
  });

  elements.promptsList.querySelectorAll('.delete-prompt').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.id!;
      deletePrompt(id);
    });
  });
}

function renderPromptOptions(): void {
  elements.defaultPrompt.innerHTML = currentPrompts
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');
  elements.defaultPrompt.value = currentSettings.defaultPromptId;
}

function renderModelOptions(): void {
  elements.geminiModel.innerHTML = GEMINI_MODELS.map(
    (m) => `<option value="${m.id}">${m.name}</option>`
  ).join('');
  elements.geminiModel.value = currentSettings.geminiModel || DEFAULT_SETTINGS.geminiModel;
}

function loadSettingsToForm(): void {
  elements.geminiApiKey.value = currentSettings.geminiApiKey;
  elements.youtubeApiKey.value = currentSettings.youtubeApiKey;
  elements.autoDetectCategory.checked = currentSettings.autoDetectCategory;
  elements.autoRefreshChannelsDaily.checked = currentSettings.autoRefreshChannelsDaily;
  elements.streamResponse.checked = currentSettings.streamResponse;
  elements.timeoutMinutes.value = String(currentSettings.summarizationTimeoutMinutes || 5);
  renderModelOptions();
  renderPromptOptions();
}

function getSettingsFromForm(): ExtensionSettings {
  const timeoutValue = parseInt(elements.timeoutMinutes.value, 10);
  const timeoutMinutes = Math.min(30, Math.max(1, isNaN(timeoutValue) ? 5 : timeoutValue));

  return {
    geminiApiKey: elements.geminiApiKey.value.trim(),
    youtubeApiKey: elements.youtubeApiKey.value.trim(),
    defaultPromptId: elements.defaultPrompt.value,
    autoDetectCategory: elements.autoDetectCategory.checked,
    autoRefreshChannelsDaily: elements.autoRefreshChannelsDaily.checked,
    streamResponse: elements.streamResponse.checked,
    theme: currentSettings.theme,
    summarizationTimeoutMinutes: timeoutMinutes,
    geminiModel: elements.geminiModel.value,
  };
}

function openAddModal(): void {
  editingPromptId = null;
  elements.modalTitle.textContent = 'Add Prompt Template';
  elements.promptName.value = '';
  elements.promptText.value = '';
  elements.promptModal.classList.remove('hidden');
}

function openEditModal(id: string): void {
  const prompt = currentPrompts.find((p) => p.id === id);
  if (!prompt) return;

  editingPromptId = id;
  elements.modalTitle.textContent = 'Edit Prompt Template';
  elements.promptName.value = prompt.name;
  elements.promptText.value = prompt.prompt;
  elements.promptModal.classList.remove('hidden');
}

function closeModalHandler(): void {
  elements.promptModal.classList.add('hidden');
  editingPromptId = null;
}

function savePromptHandler(): void {
  const name = elements.promptName.value.trim();
  const prompt = elements.promptText.value.trim();

  if (!name || !prompt) {
    showToast('Please fill in all fields');
    return;
  }

  if (editingPromptId) {
    const index = currentPrompts.findIndex((p) => p.id === editingPromptId);
    if (index !== -1) {
      currentPrompts[index] = {
        ...currentPrompts[index],
        name,
        prompt,
      };
    }
  } else {
    const id = `custom-${Date.now()}`;
    currentPrompts.push({
      id,
      name,
      prompt,
      isDefault: false,
      mappedCategories: [],
    });
  }

  renderPrompts();
  renderPromptOptions();
  closeModalHandler();
  showToast('Prompt saved');
}

function deletePrompt(id: string): void {
  const prompt = currentPrompts.find((p) => p.id === id);
  if (!prompt || prompt.isDefault) return;

  if (confirm(`Delete "${prompt.name}"?`)) {
    currentPrompts = currentPrompts.filter((p) => p.id !== id);
    renderPrompts();
    renderPromptOptions();
    showToast('Prompt deleted');
  }
}

async function testApiKey(): Promise<void> {
  const apiKey = elements.geminiApiKey.value.trim();
  if (!apiKey) {
    showToast('Please enter an API key first');
    return;
  }

  elements.testGeminiKey.disabled = true;
  elements.testGeminiKey.textContent = 'Testing...';
  elements.geminiTestResult.classList.add('hidden');

  try {
    const isValid = await sendRuntimeMessage<boolean>('TEST_API_KEY', apiKey);

    elements.geminiTestResult.classList.remove('hidden', 'success', 'error');
    if (isValid) {
      elements.geminiTestResult.classList.add('success');
      elements.geminiTestResult.textContent = 'API key is valid!';
    } else {
      elements.geminiTestResult.classList.add('error');
      elements.geminiTestResult.textContent = 'Invalid API key. Please check and try again.';
    }
  } catch {
    elements.geminiTestResult.classList.remove('hidden', 'success');
    elements.geminiTestResult.classList.add('error');
    elements.geminiTestResult.textContent = 'Failed to test API key.';
  } finally {
    elements.testGeminiKey.disabled = false;
    elements.testGeminiKey.textContent = 'Test';
  }
}

async function testYoutubeApiKey(): Promise<void> {
  const apiKey = elements.youtubeApiKey.value.trim();
  if (!apiKey) {
    showToast('Please enter a YouTube API key first');
    return;
  }

  elements.testYoutubeKey.disabled = true;
  elements.testYoutubeKey.textContent = 'Testing...';
  elements.youtubeTestResult.classList.add('hidden');

  try {
    const url = `https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&maxResults=1&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);

    elements.youtubeTestResult.classList.remove('hidden', 'success', 'error');
    if (response.ok) {
      elements.youtubeTestResult.classList.add('success');
      elements.youtubeTestResult.textContent = 'YouTube API key is valid!';
    } else if (response.status === 400 || response.status === 403) {
      elements.youtubeTestResult.classList.add('error');
      elements.youtubeTestResult.textContent =
        'Invalid API key or YouTube Data API v3 not enabled.';
    } else {
      elements.youtubeTestResult.classList.add('error');
      elements.youtubeTestResult.textContent = `API request failed (HTTP ${response.status}).`;
    }
  } catch {
    elements.youtubeTestResult.classList.remove('hidden', 'success');
    elements.youtubeTestResult.classList.add('error');
    elements.youtubeTestResult.textContent = 'Failed to test YouTube API key.';
  } finally {
    elements.testYoutubeKey.disabled = false;
    elements.testYoutubeKey.textContent = 'Test';
  }
}

async function saveAllSettings(): Promise<void> {
  try {
    const settings = getSettingsFromForm();

    await sendRuntimeMessage<ExtensionSettings>('SAVE_SETTINGS', settings);
    await sendRuntimeMessage<PromptTemplate[]>('SAVE_PROMPTS', currentPrompts);

    currentSettings = settings;
    showToast('Settings saved');
  } catch (error) {
    showToast(`Failed to save settings: ${String(error)}`);
  }
}

async function resetToDefaults(): Promise<void> {
  if (!confirm('Reset all settings and prompts to defaults?')) return;

  try {
    currentSettings = { ...DEFAULT_SETTINGS };
    currentPrompts = [...DEFAULT_PROMPTS];

    const data = await sendRuntimeMessage<StorageData>('RESET_DEFAULTS');
    if (data?.settings && data?.prompts) {
      currentSettings = data.settings;
      currentPrompts = data.prompts;
    }

    loadSettingsToForm();
    renderPrompts();
    showToast('Reset to defaults');
  } catch (error) {
    showToast(`Failed to reset settings: ${String(error)}`);
  }
}

async function initialize(): Promise<void> {
  try {
    const [settings, prompts] = await Promise.all([
      sendRuntimeMessage<ExtensionSettings>('GET_SETTINGS'),
      sendRuntimeMessage<PromptTemplate[]>('GET_PROMPTS'),
    ]);

    if (settings) {
      currentSettings = { ...DEFAULT_SETTINGS, ...settings };
    }

    if (prompts?.length) {
      currentPrompts = prompts;
    }

    loadSettingsToForm();
    renderPrompts();
  } catch (error) {
    showToast(`Failed to load settings: ${String(error)}`);
  }
}

elements.toggleGeminiKey.addEventListener('click', () =>
  togglePasswordVisibility(elements.geminiApiKey)
);
elements.toggleYoutubeKey.addEventListener('click', () =>
  togglePasswordVisibility(elements.youtubeApiKey)
);
elements.testGeminiKey.addEventListener('click', testApiKey);
elements.testYoutubeKey.addEventListener('click', testYoutubeApiKey);
elements.addPrompt.addEventListener('click', openAddModal);
elements.closeModal.addEventListener('click', closeModalHandler);
elements.cancelPrompt.addEventListener('click', closeModalHandler);
elements.savePrompt.addEventListener('click', savePromptHandler);
elements.saveSettings.addEventListener('click', saveAllSettings);
elements.resetDefaults.addEventListener('click', resetToDefaults);

elements.promptModal.querySelector('.modal-backdrop')?.addEventListener('click', closeModalHandler);

document.addEventListener('DOMContentLoaded', initialize);
