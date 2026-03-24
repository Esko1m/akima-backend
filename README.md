# Akima Music Streaming Backend

A high-performance backend API for a music streaming application. 
It bypasses the YouTube Data API by leveraging [yt-dlp](https://github.com/yt-dlp/yt-dlp) to retrieve high-speed semantic search results and direct playback audio streams automatically.

## Features
- Search endpoint with in-memory TTL caching
- Extract direct streaming URL endpoint with caching
- Custom high-speed formatting, bypassing page downloads (`--flat-playlist`, `ytsearchN`)
- Zero dependency on official developer API quotas
- Secured with standard HTTP headers, Input Validation (Zod), and Rate Limiting

## Prerequisites
1. **Node.js**: `v16.0.0` or higher
2. **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** installed globally and in `PATH`.
   - On Windows (via Scoop/Choco): `scoop install yt-dlp` or `choco install yt-dlp`
   - Alternatively: Download `yt-dlp.exe` and put it directly into your environment variable path space.

## Installation & Setup

1. **Install Node.js packages**
   ```bash
   npm install
   ```

2. **Start the API server**
   ```bash
   npm run start
   # or for development manually: node src/server.js
   ```

## Endpoints

### 1. Root / Health Check
Verifies that the API handles connections
```http
GET http://localhost:3000/
Response: { "status": "ok", "service": "akima-music-streaming-backend" }
```

### 2. Search Videos
Searches YouTube for music titles and ids without hitting limits. Returns top `10` results.
```http
GET http://localhost:3000/search?q=coldplay
```
#### Response Structure
```json
[
  {
    "title": "Coldplay - Yellow (Official Video)",
    "videoId": "yKNxeF4KMsY",
    "thumbnail": "https://i.ytimg.com/vi/yKNxeF4KMsY/hqdefault.jpg...",
    "duration": 269
  }
]
```

### 3. Extract Audio Stream
Returns the single, pure audio playback URL given a `videoId` via `yt-dlp -f bestaudio -g`
```http
GET http://localhost:3000/stream?id=yKNxeF4KMsY
```
#### Response Structure
```json
{
  "stream": "https://rr2---sn-xxxxx.googlevideo.com/videoplayback?expire..."
}
```

## Architecture Summary
- **Routes (`src/routes`)**: Contains input sanitation and logic for handling request/response formatting (powered by Express).
- **Core Services (`src/services`)**: Contains the `ytdlpService` child process wrapper, as well as an internally decoupled `cacheService` to keep searches blindingly fast avoiding redundant CLI calls.
- **Utils (`src/utils`)**: Provides a global formatting logger to track Request and Execution time details.
