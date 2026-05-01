# YouTube Client & Downloader

A high-performance YouTube client with KDE Plasma Breeze theme, built with React and Node.js.

## Features

- **KDE Breeze Theme**: Dual light/dark mode with authentic Breeze styling
- **Video Search**: Powered by YouTube.js library
- **Custom Player**: HTML5 player with quality/speed controls
- **Download Support**: Multiple formats (MP4, MP3, FLAC, Opus, Ogg)
- **403 Bypass**: yt-dlp streaming with mobile user-agent rotation

## Tech Stack

**Frontend**: React, TailwindCSS, TanStack Query, Vite
**Backend**: Node.js, Express, YouTube.js, yt-dlp, FFmpeg
**Theme**: KDE Plasma Breeze (Light/Dark)

## Installation

```bash
chmod +x install.sh
./install.sh
```

## Development

```bash
npm run dev     # Start development server
npm run build   # Build for production
npm start       # Start production server
```

## Requirements

- Node.js 18+
- Python 3.8+
- FFmpeg
- yt-dlp (nightly)

## Copyright

© 2026 YouTube Client Project