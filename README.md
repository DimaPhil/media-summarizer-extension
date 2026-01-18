# Media Summarizer Chrome Extension

A Chrome extension that summarizes video content using Google's Gemini AI. Supports YouTube with configurable prompts for different video categories.

## Features

- Summarize YouTube videos using Gemini's video understanding capabilities
- Configurable prompt templates for different video types (educational, tutorial, podcast, news, etc.)
- Automatic video category detection (with YouTube API key)
- Streaming responses for real-time summary display
- Dark mode support (follows system preference)

## Installation (Local Development)

### Prerequisites

- Node.js 18+
- npm
- Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
- (Optional) YouTube Data API key from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)

### Build Steps

1. Clone or download this repository

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist` folder

### Development Mode

Run webpack in watch mode for automatic rebuilding:
```bash
npm run dev
```

## Configuration

1. Click the extension icon and go to Settings (gear icon)
2. Enter your Gemini API key (required)
3. Optionally enter YouTube API key for auto category detection
4. Customize prompt templates as needed

## Usage

1. Navigate to a YouTube video
2. Click the extension icon
3. Select a prompt template (or let it auto-detect based on category)
4. Click "Summarize Video"
5. View the generated summary

## Prompt Templates

Built-in templates:
- **Educational Content** - For lectures and courses
- **Tutorial/How-To** - For step-by-step guides
- **Podcast/Interview** - For conversations and discussions
- **News/Current Events** - For news reports
- **Entertainment** - For reviews, vlogs, gaming
- **Technical/Conference Talk** - For tech presentations
- **General Summary** - Default fallback

You can create custom prompts in the Settings page.

## Limitations

- **Free Tier**: Max 8 hours of YouTube video per day
- **Public Videos Only**: Private/unlisted videos cannot be summarized
- **YouTube Only**: Other video platforms planned for future releases

## Project Structure

```
media-summarizer-extension/
├── src/
│   ├── background/       # Service worker and API clients
│   ├── content/          # Content script for video detection
│   ├── popup/            # Popup UI
│   ├── options/          # Settings page
│   ├── shared/           # Types, constants, errors
│   └── lib/              # Default prompts
├── public/               # Static assets (manifest, icons, HTML)
├── dist/                 # Built extension (load this in Chrome)
└── webpack.config.js     # Build configuration
```

## Tech Stack

- TypeScript
- Webpack 5
- @google/genai SDK
- Chrome Extension Manifest V3
