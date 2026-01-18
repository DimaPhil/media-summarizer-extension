import { GoogleGenAI } from '@google/genai';
import type { VideoInfo } from '../shared/types';
import { DEFAULT_MODEL } from '../shared/constants';
import { ErrorCode, SummarizationError, parseGeminiError } from '../shared/errors';

export class GeminiClient {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    if (!apiKey) {
      throw new SummarizationError(ErrorCode.NO_API_KEY);
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model || DEFAULT_MODEL;
  }

  async summarizeYouTubeVideo(videoInfo: VideoInfo, prompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [{ fileData: { fileUri: videoInfo.url } }, { text: prompt }],
          },
        ],
      });

      const text = response.text;
      if (!text) {
        throw new SummarizationError(ErrorCode.UNKNOWN_ERROR, 'Empty response from API');
      }
      return text;
    } catch (error) {
      throw parseGeminiError(error);
    }
  }

  async *summarizeYouTubeVideoStream(
    videoInfo: VideoInfo,
    prompt: string
  ): AsyncGenerator<string, void, unknown> {
    try {
      const response = await this.ai.models.generateContentStream({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [{ fileData: { fileUri: videoInfo.url } }, { text: prompt }],
          },
        ],
      });

      for await (const chunk of response) {
        const text = chunk.text;
        if (text) {
          yield text;
        }
      }
    } catch (error) {
      throw parseGeminiError(error);
    }
  }

  async summarizeTranscript(transcript: string, prompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: `${prompt}\n\n---\n\nTranscript:\n${transcript}`,
      });

      const text = response.text;
      if (!text) {
        throw new SummarizationError(ErrorCode.UNKNOWN_ERROR, 'Empty response from API');
      }
      return text;
    } catch (error) {
      throw parseGeminiError(error);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: 'Say "OK" if you can read this.',
      });
      return !!response.text;
    } catch {
      return false;
    }
  }
}

let clientInstance: GeminiClient | null = null;

export function getGeminiClient(apiKey: string): GeminiClient {
  if (!clientInstance || !apiKey) {
    clientInstance = new GeminiClient(apiKey);
  }
  return clientInstance;
}

export function resetGeminiClient(): void {
  clientInstance = null;
}
