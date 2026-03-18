import { storage } from './storage';
import { jobStore } from './job-store';

let initPromise: Promise<void> | null = null;

export async function ensureBackgroundInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await storage.initialize();
      await jobStore.initialize();

      const migrated = await jobStore.isCacheMigrated();
      if (!migrated) {
        const cachedSummaries = await storage.getAllCachedSummaries();
        await jobStore.migrateCachedSummaries(cachedSummaries);
      }
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  await initPromise;
}
