import type { SummarizationResult } from '../shared/types';

export function notifyChannelUpdated(channelId: string): void {
  chrome.runtime
    .sendMessage({
      type: 'CHANNEL_UPDATED',
      payload: { channelId },
    })
    .catch(() => {});
}

export function notifyJobUpdated(jobId: string): void {
  chrome.runtime
    .sendMessage({
      type: 'JOB_UPDATED',
      payload: { jobId },
    })
    .catch(() => {});
}

export function emitSummarizeStream(jobId: string, chunk: string, done: boolean): void {
  chrome.runtime
    .sendMessage({
      type: 'SUMMARIZE_STREAM',
      payload: { chunk, done, jobId },
    })
    .catch(() => {});
}

export function emitSummarizeResponse(payload: SummarizationResult): void {
  chrome.runtime
    .sendMessage({
      type: 'SUMMARIZE_RESPONSE',
      payload,
    })
    .catch(() => {});
}
