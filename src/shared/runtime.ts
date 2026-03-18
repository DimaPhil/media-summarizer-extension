import type { MessageType, StartJobRequest, SummarizationResult } from './types';

export async function sendRuntimeMessage<T>(
  type: MessageType | string,
  payload?: unknown
): Promise<T> {
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

export async function startJobWithRuntimeFallback(
  request: StartJobRequest
): Promise<SummarizationResult> {
  const primary = await sendRuntimeMessage<SummarizationResult | null>('START_JOB', request).catch(
    () => null
  );
  if (primary) {
    return primary;
  }

  const fallback = await sendRuntimeMessage<SummarizationResult | null>('SUMMARIZE', request);
  if (!fallback) {
    throw new Error('No response from background job runner');
  }

  return fallback;
}
