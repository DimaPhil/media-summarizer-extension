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

  private toOffset(seconds: number): string {
    return `${Math.max(0, Math.floor(seconds))}s`;
  }

  private buildYouTubeContents(
    videoInfo: VideoInfo,
    prompt: string,
    segment?: { startSec: number; endSec: number }
  ) {
    const filePart: {
      fileData: { fileUri: string };
      videoMetadata?: { startOffset?: string; endOffset?: string };
    } = {
      fileData: { fileUri: videoInfo.url },
    };

    if (segment) {
      filePart.videoMetadata = {
        startOffset: this.toOffset(segment.startSec),
        endOffset: this.toOffset(segment.endSec),
      };
    }

    return [
      {
        role: 'user',
        parts: [filePart, { text: prompt }],
      },
    ];
  }

  async summarizeYouTubeVideo(
    videoInfo: VideoInfo,
    prompt: string,
    segment?: { startSec: number; endSec: number }
  ): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: this.buildYouTubeContents(videoInfo, prompt, segment),
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
    prompt: string,
    segment?: { startSec: number; endSec: number }
  ): AsyncGenerator<string, void, unknown> {
    try {
      const response = await this.ai.models.generateContentStream({
        model: this.model,
        contents: this.buildYouTubeContents(videoInfo, prompt, segment),
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

  async mergeSegmentOutputs(
    originalPrompt: string,
    segmentOutputs: Array<{ index: number; startSec: number; endSec: number; outputText: string }>
  ): Promise<string> {
    const ordered = [...segmentOutputs].sort((a, b) => a.index - b.index);
    const combined = ordered
      .map(
        (segment) =>
          `Segment ${segment.index + 1} (${segment.startSec}s-${segment.endSec}s):\n${segment.outputText}`
      )
      .join('\n\n---\n\n');

    const mergePrompt = [
      'You are combining outputs generated from overlapping video segments.',
      'Merge these into one coherent final result.',
      'Remove duplicated overlap content and keep chronology intact.',
      'Preserve the intent of this original user prompt:',
      originalPrompt,
    ].join('\n');

    return this.summarizeTranscript(combined, mergePrompt);
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
