# Video Summarizer Chrome Extension - Technical Specification

## Overview

A Chrome extension that summarizes video content using Google's Gemini API. The extension supports YouTube (primary) and other video platforms, with configurable prompts for different video categories and automatic category detection.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Technology Stack](#technology-stack)
3. [Core Features](#core-features)
4. [API Integration](#api-integration)
5. [Data Models](#data-models)
6. [User Interface](#user-interface)
7. [Security Considerations](#security-considerations)
8. [Error Handling](#error-handling)
9. [Limitations & Constraints](#limitations--constraints)
10. [Implementation Plan](#implementation-plan)

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                              │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Popup UI   │  │  Options UI  │  │     Content Script       │  │
│  │  (popup.js)  │  │ (options.js) │  │    (content.js)          │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                        │                │
│         └────────────────┬┴────────────────────────┘                │
│                          │                                          │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Service Worker (background.js)               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │ Gemini API  │  │  YouTube    │  │  Storage Manager    │   │  │
│  │  │   Client    │  │  Data API   │  │  (chrome.storage)   │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                          │                    │
                          ▼                    ▼
              ┌───────────────────┐  ┌─────────────────────┐
              │    Gemini API     │  │  YouTube Data API   │
              │ (Video Analysis)  │  │ (Category Detection)│
              └───────────────────┘  └─────────────────────┘
```

### Directory Structure

```
video-summarizer-extension/
├── src/
│   ├── background/
│   │   ├── service-worker.ts       # Main service worker
│   │   ├── gemini-client.ts        # Gemini API wrapper
│   │   ├── youtube-api.ts          # YouTube Data API wrapper
│   │   └── storage.ts              # Storage management
│   ├── content/
│   │   └── content.ts              # Content script for page interaction
│   ├── popup/
│   │   ├── popup.html              # Popup UI
│   │   ├── popup.ts                # Popup logic
│   │   └── popup.css               # Popup styles
│   ├── options/
│   │   ├── options.html            # Options page
│   │   ├── options.ts              # Options logic
│   │   └── options.css             # Options styles
│   ├── shared/
│   │   ├── types.ts                # TypeScript interfaces
│   │   ├── constants.ts            # Constants and defaults
│   │   └── utils.ts                # Utility functions
│   └── lib/
│       └── prompts.ts              # Default prompt templates
├── public/
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon32.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   └── manifest.json               # Extension manifest
├── webpack.config.js               # Webpack configuration
├── tsconfig.json                   # TypeScript configuration
├── package.json                    # Dependencies
└── README.md                       # Documentation
```

---

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Language** | TypeScript | Type safety, better IDE support, fewer runtime errors |
| **Build Tool** | Webpack 5 | Bundle npm packages for browser, code splitting, optimization |
| **API Client** | @google/genai | Official Google Gen AI SDK (GA, actively maintained) |
| **Storage** | chrome.storage.sync | Cross-device sync, 100KB limit sufficient for prompts |
| **Styling** | CSS (no framework) | Lightweight, no build complexity |

### Key Dependencies

```json
{
  "dependencies": {
    "@google/genai": "^1.34.0"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "webpack": "^5.x",
    "webpack-cli": "^5.x",
    "ts-loader": "^9.x",
    "copy-webpack-plugin": "^12.x"
  }
}
```

---

## Core Features

### 1. Video Summarization

**Primary Method: Gemini Video Understanding with YouTube URLs**

The Gemini API natively supports YouTube URLs, eliminating the need for transcript extraction:

```typescript
const response = await ai.models.generateContent({
  model: "gemini-2.0-flash",
  contents: [
    { fileData: { fileUri: "https://www.youtube.com/watch?v=VIDEO_ID" } },
    { text: userPrompt }
  ]
});
```

**Fallback Method: Transcript-based (for non-YouTube platforms)**

For other video platforms, use transcript extraction where available:
- Parse transcript from page DOM (platform-specific)
- Send transcript text to Gemini for summarization

### 2. Configurable Prompts

Users can create, edit, and delete custom prompts for different video types:

| Prompt Category | Example Use Case |
|-----------------|------------------|
| Educational | Lectures, tutorials, courses |
| Tutorial | How-to videos, coding tutorials |
| Podcast | Interviews, discussions |
| News | News reports, current events |
| Entertainment | Reviews, vlogs |
| Technical | Conference talks, demos |
| Custom | User-defined categories |

### 3. Automatic Category Detection

**Using YouTube Data API v3:**

```typescript
// GET https://www.googleapis.com/youtube/v3/videos?part=snippet&id={VIDEO_ID}&key={API_KEY}

interface VideoSnippet {
  categoryId: string;  // e.g., "27" for Education
  title: string;
  description: string;
  tags: string[];
}
```

**YouTube Category ID Mapping:**

| ID | Category | Suggested Prompt Type |
|----|----------|----------------------|
| 1 | Film & Animation | entertainment |
| 10 | Music | entertainment |
| 17 | Sports | news |
| 20 | Gaming | entertainment |
| 22 | People & Blogs | podcast |
| 24 | Entertainment | entertainment |
| 25 | News & Politics | news |
| 26 | Howto & Style | tutorial |
| 27 | Education | educational |
| 28 | Science & Technology | technical |

### 4. Platform Detection

```typescript
interface SupportedPlatform {
  name: string;
  urlPatterns: RegExp[];
  videoIdExtractor: (url: string) => string | null;
  supportsGeminiUrl: boolean;  // Only YouTube currently
}

const platforms: SupportedPlatform[] = [
  {
    name: 'youtube',
    urlPatterns: [/youtube\.com\/watch/, /youtu\.be\//],
    videoIdExtractor: extractYouTubeId,
    supportsGeminiUrl: true
  },
  {
    name: 'vimeo',
    urlPatterns: [/vimeo\.com\/\d+/],
    videoIdExtractor: extractVimeoId,
    supportsGeminiUrl: false  // Requires transcript fallback
  }
];
```

---

## API Integration

### Gemini API Configuration

**Model Selection:** `gemini-2.0-flash` (fast, cost-effective for summarization)

> Note: The user mentioned `gemini-3-flash-preview` but this model doesn't exist. Using `gemini-2.0-flash` which is the current fast model. Can be updated to `gemini-2.5-flash` when available.

**API Initialization:**

```typescript
import { GoogleGenAI } from '@google/genai';

class GeminiClient {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async summarizeYouTubeVideo(videoUrl: string, prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        { fileData: { fileUri: videoUrl } },
        { text: prompt }
      ]
    });
    return response.text ?? '';
  }

  async summarizeTranscript(transcript: string, prompt: string): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `${prompt}\n\nTranscript:\n${transcript}`
    });
    return response.text ?? '';
  }
}
```

### YouTube Data API (Optional - for category detection)

**Endpoint:** `GET https://www.googleapis.com/youtube/v3/videos`

**Parameters:**
- `part`: `snippet`
- `id`: Video ID
- `key`: YouTube API Key

**Note:** YouTube Data API is optional. If no key is provided, users manually select prompts.

---

## Data Models

### TypeScript Interfaces

```typescript
// src/shared/types.ts

export interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
  isDefault: boolean;
  mappedCategories: string[];  // YouTube category IDs
}

export interface ExtensionSettings {
  geminiApiKey: string;
  youtubeApiKey?: string;  // Optional
  defaultPromptId: string;
  autoDetectCategory: boolean;
  streamResponse: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface SummarizationRequest {
  videoUrl: string;
  platform: string;
  promptId: string;
  videoId: string;
}

export interface SummarizationResponse {
  success: boolean;
  summary?: string;
  error?: string;
  metadata?: {
    videoTitle: string;
    videoDuration: string;
    category: string;
  };
}

export interface StorageData {
  settings: ExtensionSettings;
  prompts: PromptTemplate[];
  history: SummarizationHistoryEntry[];
}

export interface SummarizationHistoryEntry {
  id: string;
  videoUrl: string;
  videoTitle: string;
  promptUsed: string;
  summary: string;
  timestamp: number;
}
```

### Default Prompts

```typescript
// src/lib/prompts.ts

export const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    id: 'educational',
    name: 'Educational Content',
    prompt: `Summarize this educational video with the following structure:

1. **Main Topic**: What is this video teaching?
2. **Key Concepts**: List 3-5 main concepts explained
3. **Important Details**: Critical facts, formulas, or definitions
4. **Practical Applications**: How can this knowledge be applied?
5. **Summary**: 2-3 sentence overview

Be concise but comprehensive.`,
    isDefault: true,
    mappedCategories: ['27']  // Education
  },
  {
    id: 'tutorial',
    name: 'Tutorial/How-To',
    prompt: `Extract a step-by-step guide from this tutorial video:

1. **Goal**: What will the viewer learn to do?
2. **Prerequisites**: What's needed before starting?
3. **Steps**: Numbered list of actions to take
4. **Tips**: Any pro tips or warnings mentioned
5. **Final Result**: What should be achieved

Format steps clearly for easy following.`,
    isDefault: true,
    mappedCategories: ['26', '28']  // Howto & Style, Science & Tech
  },
  {
    id: 'podcast',
    name: 'Podcast/Interview',
    prompt: `Summarize this podcast/interview:

1. **Participants**: Who is speaking?
2. **Main Topics**: Key subjects discussed
3. **Notable Quotes**: 2-3 memorable statements
4. **Key Insights**: Main takeaways from the conversation
5. **Conclusion**: How did it wrap up?

Capture the essence of the discussion.`,
    isDefault: true,
    mappedCategories: ['22']  // People & Blogs
  },
  {
    id: 'news',
    name: 'News/Current Events',
    prompt: `Analyze this news video:

1. **Headline**: What's the main story?
2. **Key Facts**: Who, what, when, where, why
3. **Sources**: Who provided information?
4. **Context**: Background information mentioned
5. **Impact**: Why does this matter?

Be factual and objective.`,
    isDefault: true,
    mappedCategories: ['25']  // News & Politics
  },
  {
    id: 'general',
    name: 'General Summary',
    prompt: `Provide a comprehensive summary of this video:

1. **Overview**: What is this video about?
2. **Key Points**: Main ideas presented (bullet points)
3. **Details**: Important specifics mentioned
4. **Conclusion**: How does it end?

Keep it concise but informative.`,
    isDefault: true,
    mappedCategories: []  // Fallback for any category
  }
];
```

---

## User Interface

### Popup UI (Main Interface)

```
┌─────────────────────────────────────┐
│  🎬 Video Summarizer          [⚙️] │
├─────────────────────────────────────┤
│                                     │
│  📹 Current Video:                  │
│  ┌─────────────────────────────────┐│
│  │ [Video Title - truncated...]   ││
│  │ youtube.com • 15:32            ││
│  └─────────────────────────────────┘│
│                                     │
│  📝 Select Prompt:                  │
│  ┌─────────────────────────────────┐│
│  │ Educational Content        ▼   ││
│  └─────────────────────────────────┘│
│  ☑️ Auto-detect from category       │
│                                     │
│  ┌─────────────────────────────────┐│
│  │        ▶️ Summarize             ││
│  └─────────────────────────────────┘│
│                                     │
│  ─────────────────────────────────  │
│  📄 Summary:                        │
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  │  [Summary text appears here    ││
│  │   with markdown formatting]    ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  [📋 Copy]  [💾 Save]  [🔄 Retry]   │
└─────────────────────────────────────┘
```

### Options Page

```
┌──────────────────────────────────────────────────────────────┐
│  Video Summarizer - Settings                                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  🔑 API Configuration                                        │
│  ├─────────────────────────────────────────────────────────┤│
│  │ Gemini API Key:                                         ││
│  │ [••••••••••••••••••••••••••••]  [Show] [Test]          ││
│  │                                                         ││
│  │ YouTube API Key (optional):                             ││
│  │ [••••••••••••••••••••••••••••]  [Show] [Test]          ││
│  │ ℹ️ Required for auto category detection                 ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  📝 Prompt Templates                                         │
│  ├─────────────────────────────────────────────────────────┤│
│  │ [+ Add New Prompt]                                      ││
│  │                                                         ││
│  │ ┌─────────────────────────────────────────────────────┐ ││
│  │ │ 📚 Educational Content              [Edit] [Delete] │ ││
│  │ │ Categories: Education                               │ ││
│  │ └─────────────────────────────────────────────────────┘ ││
│  │ ┌─────────────────────────────────────────────────────┐ ││
│  │ │ 🔧 Tutorial/How-To                  [Edit] [Delete] │ ││
│  │ │ Categories: Howto & Style, Science & Tech           │ ││
│  │ └─────────────────────────────────────────────────────┘ ││
│  │ ...                                                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ⚙️ Preferences                                              │
│  ├─────────────────────────────────────────────────────────┤│
│  │ Default Prompt:     [General Summary        ▼]          ││
│  │ Auto-detect:        [✓] Use video category              ││
│  │ Stream responses:   [✓] Show summary as it generates    ││
│  │ Theme:              [System ▼]                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│                                    [Save Settings]           │
└──────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

### API Key Storage

```typescript
// Store API keys securely in chrome.storage.local (not sync for sensitive data)
// Keys are never exposed in content scripts

class SecureStorage {
  static async setApiKey(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  static async getApiKey(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  }
}
```

### Content Security Policy

```json
// manifest.json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

### Permission Minimization

Only request necessary permissions:

```json
{
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://generativelanguage.googleapis.com/*",
    "https://www.googleapis.com/youtube/*"
  ]
}
```

---

## Error Handling

### Error Types and Handling

```typescript
// src/shared/errors.ts

export enum ErrorCode {
  NO_VIDEO_DETECTED = 'NO_VIDEO_DETECTED',
  INVALID_API_KEY = 'INVALID_API_KEY',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  VIDEO_TOO_LONG = 'VIDEO_TOO_LONG',
  PRIVATE_VIDEO = 'PRIVATE_VIDEO',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM',
  TRANSCRIPT_UNAVAILABLE = 'TRANSCRIPT_UNAVAILABLE'
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.NO_VIDEO_DETECTED]: 'No video detected on this page. Please navigate to a video.',
  [ErrorCode.INVALID_API_KEY]: 'Invalid API key. Please check your settings.',
  [ErrorCode.API_RATE_LIMIT]: 'API rate limit exceeded. Please try again later.',
  [ErrorCode.VIDEO_TOO_LONG]: 'Video exceeds the daily limit (8 hours for free tier).',
  [ErrorCode.PRIVATE_VIDEO]: 'Cannot summarize private or unlisted videos.',
  [ErrorCode.NETWORK_ERROR]: 'Network error. Please check your connection.',
  [ErrorCode.UNSUPPORTED_PLATFORM]: 'This video platform is not yet supported.',
  [ErrorCode.TRANSCRIPT_UNAVAILABLE]: 'No transcript available for this video.'
};

export class SummarizationError extends Error {
  constructor(public code: ErrorCode, public details?: string) {
    super(ERROR_MESSAGES[code]);
    this.name = 'SummarizationError';
  }
}
```

### Retry Logic

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain errors
      if (error instanceof SummarizationError) {
        const nonRetryable = [
          ErrorCode.INVALID_API_KEY,
          ErrorCode.PRIVATE_VIDEO,
          ErrorCode.UNSUPPORTED_PLATFORM
        ];
        if (nonRetryable.includes(error.code)) throw error;
      }

      if (attempt < maxRetries) {
        await sleep(delayMs * attempt);  // Exponential backoff
      }
    }
  }

  throw lastError;
}
```

---

## Limitations & Constraints

### Gemini API Limits (Free Tier)

| Constraint | Limit |
|------------|-------|
| YouTube video per day | 8 hours total |
| Videos per request | 1 (Gemini 2.0) or 10 (Gemini 2.5+) |
| Video accessibility | Public videos only |
| Request rate | 15 requests/minute |

### Chrome Extension Limits

| Constraint | Limit |
|------------|-------|
| chrome.storage.sync | 100KB total, 8KB per item |
| chrome.storage.local | 10MB total |
| Service worker idle | Terminates after ~30 seconds |

### Platform Support

| Platform | Gemini URL Support | Transcript Fallback | Status |
|----------|-------------------|---------------------|--------|
| YouTube | Yes | Yes | Full support |
| Vimeo | No | Partial | Limited support |
| Dailymotion | No | No | Planned |
| Twitch VOD | No | No | Planned |

---

## Implementation Plan

### Phase 1: Project Setup & Core Infrastructure

**Step 1.1: Initialize Project**
- Create project directory structure
- Initialize npm with TypeScript
- Configure webpack for Chrome extension bundling
- Set up manifest.json (Manifest V3)

**Step 1.2: TypeScript Configuration**
- Configure tsconfig.json for browser environment
- Set up path aliases for clean imports
- Configure strict mode for type safety

**Step 1.3: Build Pipeline**
- Webpack configuration for multiple entry points
- Dev/production build modes
- Auto-copy static assets (manifest, icons, HTML)

### Phase 2: Storage & Settings Management

**Step 2.1: Storage Module**
- Implement chrome.storage wrapper with TypeScript
- Handle migration for settings schema changes
- Implement default settings initialization

**Step 2.2: Options Page**
- Create options.html layout
- Implement API key management (save, test, mask)
- Build prompt template CRUD interface

### Phase 3: Gemini API Integration

**Step 3.1: Gemini Client**
- Initialize @google/genai with API key
- Implement YouTube URL summarization method
- Implement transcript summarization fallback
- Add streaming response support

**Step 3.2: Error Handling**
- Map Gemini API errors to user-friendly messages
- Implement retry logic with exponential backoff
- Handle rate limiting gracefully

### Phase 4: Platform Detection & Video Extraction

**Step 4.1: Platform Detection**
- Implement URL pattern matching for supported platforms
- Extract video IDs from URLs
- Detect current page video status

**Step 4.2: Content Script**
- Inject content script on video pages
- Extract video metadata (title, duration)
- Communicate with service worker via messaging

### Phase 5: YouTube Category Detection (Optional)

**Step 5.1: YouTube Data API Integration**
- Implement category fetching for YouTube videos
- Cache category data to reduce API calls
- Map categories to prompt templates

**Step 5.2: Auto-Detection Logic**
- Implement category-to-prompt mapping
- Allow user override of auto-detected prompt
- Handle missing/unknown categories gracefully

### Phase 6: Popup UI

**Step 6.1: Popup Structure**
- Create popup.html layout
- Style with CSS (light/dark theme support)
- Implement responsive design for narrow width

**Step 6.2: Popup Logic**
- Detect current video on active tab
- Implement prompt selector dropdown
- Handle summarization request/response
- Display summary with markdown rendering

**Step 6.3: UX Enhancements**
- Add loading states and progress indicators
- Implement copy-to-clipboard functionality
- Add summary history (optional)

### Phase 7: Testing & Polish

**Step 7.1: Manual Testing**
- Test with various YouTube video types
- Test error scenarios (no video, private video, etc.)
- Test across different video lengths

**Step 7.2: Edge Cases**
- Handle service worker termination/restart
- Handle API key changes during summarization
- Handle network disconnection

**Step 7.3: Performance Optimization**
- Minimize bundle size
- Lazy load options page
- Optimize storage reads/writes

### Phase 8: Documentation & Release

**Step 8.1: Documentation**
- Write user guide in README
- Document prompt customization
- Add troubleshooting section

**Step 8.2: Local Installation**
- Create installation instructions
- Document API key setup process
- Provide sample prompts for common use cases

---

## File-by-File Implementation Order

```
1.  package.json                 # Dependencies and scripts
2.  tsconfig.json                # TypeScript configuration
3.  webpack.config.js            # Build configuration
4.  public/manifest.json         # Extension manifest
5.  src/shared/types.ts          # TypeScript interfaces
6.  src/shared/constants.ts      # Constants and config
7.  src/shared/errors.ts         # Error definitions
8.  src/lib/prompts.ts           # Default prompt templates
9.  src/background/storage.ts    # Storage management
10. src/background/gemini-client.ts  # Gemini API wrapper
11. src/background/youtube-api.ts    # YouTube API wrapper
12. src/background/service-worker.ts # Main service worker
13. src/content/content.ts       # Content script
14. src/options/options.html     # Options page HTML
15. src/options/options.css      # Options page styles
16. src/options/options.ts       # Options page logic
17. src/popup/popup.html         # Popup HTML
18. src/popup/popup.css          # Popup styles
19. src/popup/popup.ts           # Popup logic
20. public/icons/*               # Extension icons
```

---

## Success Criteria

| Criteria | Target |
|----------|--------|
| Summarize YouTube video | < 30 seconds for 10-min video |
| API error handling | User-friendly messages for all error types |
| Prompt customization | Full CRUD operations working |
| Auto-category detection | Correct prompt selected 80%+ of time |
| UI responsiveness | No freezing during API calls |
| Storage persistence | Settings survive browser restart |

---

## Future Enhancements (Post-MVP)

1. **Backend API** - Move API calls to backend for key protection
2. **Additional platforms** - Vimeo, Twitch, Dailymotion support
3. **Summary history** - Searchable history of past summaries
4. **Export options** - Export to Notion, Obsidian, etc.
5. **Keyboard shortcuts** - Quick summarize with hotkey
6. **Batch processing** - Summarize playlist of videos
7. **Custom models** - Support for different Gemini models
8. **Localization** - Multi-language UI support

---

## References

- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Gemini Video Understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Google Gen AI SDK (JS)](https://github.com/googleapis/js-genai)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [YouTube Data API v3](https://developers.google.com/youtube/v3/docs/videos/list)
- [YouTube Category IDs](https://gist.github.com/dgp/1b24bf2961521bd75d6c)
- [Webpack Chrome Extension Boilerplate](https://github.com/AlejandroAO/chrome-extension-boilerplate)
