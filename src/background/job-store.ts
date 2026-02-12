import { JOB_DB } from '../shared/constants';
import type {
  CachedSummary,
  Job,
  JobListQuery,
  JobSegment,
  JobStatus,
  Platform,
} from '../shared/types';

interface ActiveJobRecord {
  videoKey: string;
  jobId: string;
  createdAt: number;
  updatedAt: number;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

interface CompleteJobUpdate {
  status: JobStatus;
  outputText?: string;
  mergeOutputText?: string;
  errorMessage?: string;
  finishedAt?: number;
  segments?: JobSegment[];
}

interface CreateRunningJobResult {
  created: boolean;
  job: Job;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export function getVideoKey(videoId: string, platform: Platform): string {
  return `${platform}:${videoId}`;
}

class JobStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async initialize(): Promise<void> {
    await this.openDb();
  }

  private async openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(JOB_DB.NAME, JOB_DB.VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(JOB_DB.STORES.JOBS)) {
          const jobsStore = db.createObjectStore(JOB_DB.STORES.JOBS, { keyPath: 'jobId' });
          jobsStore.createIndex('byVideoKey', 'videoKey', { unique: false });
          jobsStore.createIndex('byStatus', 'status', { unique: false });
          jobsStore.createIndex('byCreatedAt', 'createdAt', { unique: false });
          jobsStore.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY)) {
          db.createObjectStore(JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY, { keyPath: 'videoKey' });
        }

        if (!db.objectStoreNames.contains(JOB_DB.STORES.META)) {
          db.createObjectStore(JOB_DB.STORES.META, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open jobs database'));
    });

    return this.dbPromise;
  }

  private createJobId(): string {
    const entropy =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `job_${Date.now()}_${entropy}`;
  }

  async createRunningJob(
    job: Omit<Job, 'jobId' | 'createdAt' | 'startedAt' | 'updatedAt' | 'status'>
  ): Promise<CreateRunningJobResult> {
    const db = await this.openDb();
    const now = Date.now();
    const newJob: Job = {
      ...job,
      jobId: this.createJobId(),
      status: 'RUNNING',
      createdAt: now,
      startedAt: now,
      updatedAt: now,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [JOB_DB.STORES.JOBS, JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY],
        'readwrite'
      );
      const jobsStore = tx.objectStore(JOB_DB.STORES.JOBS);
      const activeStore = tx.objectStore(JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY);
      let result: CreateRunningJobResult | null = null;

      const activeReq = activeStore.get(newJob.videoKey);
      activeReq.onerror = () =>
        reject(activeReq.error ?? new Error('Failed to read active job lock'));
      activeReq.onsuccess = () => {
        const activeRecord = activeReq.result as ActiveJobRecord | undefined;
        if (activeRecord) {
          const existingReq = jobsStore.get(activeRecord.jobId);
          existingReq.onerror = () =>
            reject(existingReq.error ?? new Error('Failed to read running job record'));
          existingReq.onsuccess = () => {
            const existingJob = existingReq.result as Job | undefined;
            if (existingJob) {
              result = { created: false, job: existingJob };
              return;
            }

            const deleteReq = activeStore.delete(newJob.videoKey);
            deleteReq.onerror = () =>
              reject(deleteReq.error ?? new Error('Failed to clean stale active lock'));
            deleteReq.onsuccess = () => {
              jobsStore.add(newJob);
              activeStore.put({
                videoKey: newJob.videoKey,
                jobId: newJob.jobId,
                createdAt: now,
                updatedAt: now,
              } satisfies ActiveJobRecord);
              result = { created: true, job: newJob };
            };
          };
          return;
        }

        jobsStore.add(newJob);
        activeStore.put({
          videoKey: newJob.videoKey,
          jobId: newJob.jobId,
          createdAt: now,
          updatedAt: now,
        } satisfies ActiveJobRecord);
        result = { created: true, job: newJob };
      };

      transactionComplete(tx)
        .then(() => {
          if (!result) {
            reject(new Error('Failed to create or retrieve running job'));
            return;
          }
          resolve(result);
        })
        .catch(reject);
    });
  }

  async getJob(jobId: string): Promise<Job | null> {
    const db = await this.openDb();
    const tx = db.transaction(JOB_DB.STORES.JOBS, 'readonly');
    const job = await requestToPromise(tx.objectStore(JOB_DB.STORES.JOBS).get(jobId));
    return (job as Job | undefined) ?? null;
  }

  async getActiveJobByVideoKey(videoKey: string): Promise<Job | null> {
    const db = await this.openDb();
    const tx = db.transaction([JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY, JOB_DB.STORES.JOBS], 'readonly');
    const activeStore = tx.objectStore(JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY);
    const jobsStore = tx.objectStore(JOB_DB.STORES.JOBS);
    const active = (await requestToPromise(activeStore.get(videoKey))) as
      | ActiveJobRecord
      | undefined;
    if (!active) {
      return null;
    }
    const job = await requestToPromise(jobsStore.get(active.jobId));
    return (job as Job | undefined) ?? null;
  }

  async listJobs(query?: JobListQuery): Promise<Job[]> {
    const db = await this.openDb();
    const tx = db.transaction(JOB_DB.STORES.JOBS, 'readonly');
    const store = tx.objectStore(JOB_DB.STORES.JOBS);
    const rawJobs = query?.status
      ? await requestToPromise(store.index('byStatus').getAll(query.status))
      : await requestToPromise(store.getAll());
    const jobs = (rawJobs as Job[]).sort((a, b) => b.createdAt - a.createdAt);
    if (query?.limit && query.limit > 0) {
      return jobs.slice(0, query.limit);
    }
    return jobs;
  }

  async appendJobOutput(
    jobId: string,
    chunk: string,
    segment?: { index: number; startSec: number; endSec: number }
  ): Promise<Job | null> {
    const db = await this.openDb();
    const tx = db.transaction(JOB_DB.STORES.JOBS, 'readwrite');
    const store = tx.objectStore(JOB_DB.STORES.JOBS);
    const job = (await requestToPromise(store.get(jobId))) as Job | undefined;

    if (!job) {
      return null;
    }

    const nextUpdatedAt = Date.now();
    const nextSegments = [...(job.segments ?? [])];
    if (segment) {
      const segmentIndex = nextSegments.findIndex((item) => item.index === segment.index);
      if (segmentIndex === -1) {
        nextSegments.push({
          index: segment.index,
          startSec: segment.startSec,
          endSec: segment.endSec,
          outputText: chunk,
        });
      } else {
        const existing = nextSegments[segmentIndex];
        nextSegments[segmentIndex] = {
          ...existing,
          outputText: `${existing.outputText}${chunk}`,
        };
      }
    }

    const updatedJob: Job = {
      ...job,
      outputText: `${job.outputText}${chunk}`,
      updatedAt: nextUpdatedAt,
      segments: segment ? nextSegments.sort((a, b) => a.index - b.index) : job.segments,
    };

    store.put(updatedJob);
    await transactionComplete(tx);
    return updatedJob;
  }

  async updateJob(jobId: string, updates: Partial<Job>): Promise<Job | null> {
    const db = await this.openDb();
    const tx = db.transaction(JOB_DB.STORES.JOBS, 'readwrite');
    const store = tx.objectStore(JOB_DB.STORES.JOBS);
    const job = (await requestToPromise(store.get(jobId))) as Job | undefined;
    if (!job) {
      return null;
    }

    const updatedJob: Job = {
      ...job,
      ...updates,
      updatedAt: Date.now(),
    };
    store.put(updatedJob);
    await transactionComplete(tx);
    return updatedJob;
  }

  async completeJob(jobId: string, update: CompleteJobUpdate): Promise<Job | null> {
    const db = await this.openDb();
    const tx = db.transaction([JOB_DB.STORES.JOBS, JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY], 'readwrite');
    const jobsStore = tx.objectStore(JOB_DB.STORES.JOBS);
    const activeStore = tx.objectStore(JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY);
    const job = (await requestToPromise(jobsStore.get(jobId))) as Job | undefined;

    if (!job) {
      return null;
    }

    const finishedAt = update.finishedAt ?? Date.now();
    const updatedJob: Job = {
      ...job,
      ...update,
      finishedAt,
      updatedAt: finishedAt,
    };

    jobsStore.put(updatedJob);
    const active = (await requestToPromise(activeStore.get(job.videoKey))) as
      | ActiveJobRecord
      | undefined;
    if (active?.jobId === jobId) {
      activeStore.delete(job.videoKey);
    }
    await transactionComplete(tx);
    return updatedJob;
  }

  async updateEditedText(jobId: string, editedText: string): Promise<Job | null> {
    return this.updateJob(jobId, { editedText });
  }

  async deleteJob(jobId: string): Promise<boolean> {
    const db = await this.openDb();
    const tx = db.transaction([JOB_DB.STORES.JOBS, JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY], 'readwrite');
    const jobsStore = tx.objectStore(JOB_DB.STORES.JOBS);
    const activeStore = tx.objectStore(JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY);
    const job = (await requestToPromise(jobsStore.get(jobId))) as Job | undefined;
    if (!job) {
      return false;
    }

    jobsStore.delete(jobId);
    const active = (await requestToPromise(activeStore.get(job.videoKey))) as
      | ActiveJobRecord
      | undefined;
    if (active?.jobId === jobId) {
      activeStore.delete(job.videoKey);
    }
    await transactionComplete(tx);
    return true;
  }

  async clearAllJobs(): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction([JOB_DB.STORES.JOBS, JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY], 'readwrite');
    tx.objectStore(JOB_DB.STORES.JOBS).clear();
    tx.objectStore(JOB_DB.STORES.ACTIVE_BY_VIDEO_KEY).clear();
    await transactionComplete(tx);
  }

  async isCacheMigrated(): Promise<boolean> {
    const db = await this.openDb();
    const tx = db.transaction(JOB_DB.STORES.META, 'readonly');
    const result = (await requestToPromise(
      tx.objectStore(JOB_DB.STORES.META).get(JOB_DB.META_KEYS.CACHE_MIGRATED)
    )) as MetaRecord | undefined;
    return result?.value === true;
  }

  async markCacheMigrated(): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(JOB_DB.STORES.META, 'readwrite');
    tx.objectStore(JOB_DB.STORES.META).put({
      key: JOB_DB.META_KEYS.CACHE_MIGRATED,
      value: true,
    } satisfies MetaRecord);
    await transactionComplete(tx);
  }

  async migrateCachedSummaries(cachedSummaries: CachedSummary[]): Promise<void> {
    if (!cachedSummaries.length) {
      await this.markCacheMigrated();
      return;
    }

    const db = await this.openDb();
    const tx = db.transaction([JOB_DB.STORES.JOBS, JOB_DB.STORES.META], 'readwrite');
    const jobsStore = tx.objectStore(JOB_DB.STORES.JOBS);
    const metaStore = tx.objectStore(JOB_DB.STORES.META);

    for (const item of cachedSummaries) {
      const timestamp = item.timestamp || Date.now();
      const baseJobId = this.createJobId();
      const migratedJob: Job = {
        jobId: `${baseJobId}_migrated`,
        videoKey: getVideoKey(item.videoId, item.platform),
        platform: item.platform,
        videoId: item.videoId,
        videoUrl: item.videoUrl,
        videoTitle: item.videoTitle,
        thumbnailUrl:
          item.platform === 'youtube'
            ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`
            : undefined,
        promptId: item.promptId,
        promptName: item.promptName,
        promptTextSnapshot: '',
        modelSnapshot: {
          model: 'unknown',
          streamResponse: false,
          summarizationTimeoutMinutes: 5,
          chunkingUsed: false,
        },
        status: 'SUCCEEDED',
        createdAt: timestamp,
        startedAt: timestamp,
        updatedAt: timestamp,
        finishedAt: timestamp,
        outputText: item.summary,
      };
      jobsStore.put(migratedJob);
    }

    metaStore.put({
      key: JOB_DB.META_KEYS.CACHE_MIGRATED,
      value: true,
    } satisfies MetaRecord);
    await transactionComplete(tx);
  }
}

export const jobStore = new JobStore();
