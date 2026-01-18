import type { ExtensionSettings, PromptTemplate, StorageData } from '../shared/types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants';
import { DEFAULT_PROMPTS } from '../lib/prompts';

class StorageManager {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const data = await chrome.storage.sync.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.PROMPTS]);

    if (!data[STORAGE_KEYS.SETTINGS]) {
      await this.saveSettings(DEFAULT_SETTINGS);
    }

    if (!data[STORAGE_KEYS.PROMPTS]) {
      await this.savePrompts(DEFAULT_PROMPTS);
    }

    this.initialized = true;
  }

  async getSettings(): Promise<ExtensionSettings> {
    await this.initialize();
    const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };
  }

  async saveSettings(settings: ExtensionSettings): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
  }

  async updateSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
    const current = await this.getSettings();
    const updated = { ...current, ...partial };
    await this.saveSettings(updated);
    return updated;
  }

  async getPrompts(): Promise<PromptTemplate[]> {
    await this.initialize();
    const data = await chrome.storage.sync.get(STORAGE_KEYS.PROMPTS);
    return data[STORAGE_KEYS.PROMPTS] || DEFAULT_PROMPTS;
  }

  async savePrompts(prompts: PromptTemplate[]): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEYS.PROMPTS]: prompts });
  }

  async addPrompt(prompt: PromptTemplate): Promise<PromptTemplate[]> {
    const prompts = await this.getPrompts();
    prompts.push(prompt);
    await this.savePrompts(prompts);
    return prompts;
  }

  async updatePrompt(id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate[]> {
    const prompts = await this.getPrompts();
    const index = prompts.findIndex((p) => p.id === id);
    if (index !== -1) {
      prompts[index] = { ...prompts[index], ...updates };
      await this.savePrompts(prompts);
    }
    return prompts;
  }

  async deletePrompt(id: string): Promise<PromptTemplate[]> {
    const prompts = await this.getPrompts();
    const filtered = prompts.filter((p) => p.id !== id || p.isDefault);
    await this.savePrompts(filtered);
    return filtered;
  }

  async getPromptById(id: string): Promise<PromptTemplate | undefined> {
    const prompts = await this.getPrompts();
    return prompts.find((p) => p.id === id);
  }

  async getPromptForCategory(categoryId: string): Promise<PromptTemplate | undefined> {
    const prompts = await this.getPrompts();
    return prompts.find((p) => p.mappedCategories.includes(categoryId));
  }

  async getAllData(): Promise<StorageData> {
    const [settings, prompts] = await Promise.all([
      this.getSettings(),
      this.getPrompts(),
    ]);
    return { settings, prompts };
  }

  async resetToDefaults(): Promise<void> {
    await Promise.all([
      this.saveSettings(DEFAULT_SETTINGS),
      this.savePrompts(DEFAULT_PROMPTS),
    ]);
    this.initialized = false;
  }
}

export const storage = new StorageManager();
