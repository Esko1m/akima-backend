const ytSearch = require('yt-search');
const logger = require('../utils/logger');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const os = require('os');
const path = require('path');

/**
 * Service to handle YouTube search and stream extraction.
 * Optimized for Docker environments (Render/Railway) using the real yt-dlp binary.
 */
class YtDlpService {
    constructor() {
        // Path to yt-dlp binary. 
        // In Docker (Docker-bullseye-slim), it will be in /usr/local/bin/yt-dlp
        // In Windows local dev, it's in the root.
        this.binPath = os.platform() === 'win32'
            ? path.resolve(__dirname, '../../yt-dlp.exe')
            : 'yt-dlp'; // Assumes global availability in Linux/Docker

        // Path to cookies file if it exists
        this.cookiesPath = path.resolve(__dirname, '../../yt-cookies.txt');
    }

    /**
     * Search for videos using yt-search (JS-based, fast and rarely blocked)
     */
    async searchVideos(query, limit = 10) {
        const startTime = Date.now();
        try {
            const r = await ytSearch(query);
            const videos = r.videos.slice(0, limit);

            const results = videos.map(video => ({
                title: video.title,
                videoId: video.videoId,
                thumbnail: video.thumbnail || video.image || null,
                duration: video.seconds || 0
            }));

            const execTime = Date.now() - startTime;
            logger.info('Search executed successfully', { query, execTime, count: results.length });

            return results;
        } catch (error) {
            logger.error('Search failed', { query, error: error.message });
            // Fallback to yt-dlp for search if JS fails
            return this.searchVideosYtDlp(query, limit);
        }
    }

    /**
     * Extract direct playback stream URL using the REAL yt-dlp binary.
     * This is the most robust method and bypasses "Sign in to confirm you're not a bot".
     */
    async extractAudioStream(videoId) {
        const startTime = Date.now();
        const url = `https://www.youtube.com/watch?v=${videoId}`;

        // Build arguments for yt-dlp
        // -f bestaudio[ext=m4a] ensures we get a format compatible with mobile players
        const args = [
            '-f', 'bestaudio[ext=m4a]/bestaudio/best',
            '-g', // Just get the URL
            '--no-warnings',
            '--no-check-certificates',
            '--rm-cache-dir',
            url
        ];

        // Add cookies if the file exists (VITAL for bypassing bot detection)
        const fs = require('fs');
        if (fs.existsSync(this.cookiesPath)) {
            args.push('--cookies', this.cookiesPath);
            logger.info('Using yt-cookies.txt for extraction', { videoId });
        }

        try {
            const { stdout } = await execFileAsync(this.binPath, args);
            const streamUrl = (stdout || '').split('\n')[0].trim();

            if (streamUrl && streamUrl.startsWith('http')) {
                const execTime = Date.now() - startTime;
                logger.info('yt-dlp extraction succeeded', { videoId, execTime });
                return streamUrl;
            }
            throw new Error('yt-dlp returned no valid URL');
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('yt-dlp extraction failed', { videoId, execTime, error: error.message });
            throw new Error(`Stream extraction failed: ${error.message}`);
        }
    }

    /**
     * Backup yt-dlp search
     */
    async searchVideosYtDlp(query, limit = 5) {
        const args = [
            `ytsearch${limit}:${query}`,
            '--dump-json',
            '--no-warnings',
            '--flat-playlist'
        ];

        try {
            const { stdout } = await execFileAsync(this.binPath, args);
            const lines = stdout.trim().split('\n');
            const seenIds = new Set();

            return lines.map(line => {
                if (!line) return null;
                try {
                    const data = JSON.parse(line);
                    if (seenIds.has(data.id)) return null;
                    seenIds.add(data.id);
                    return {
                        title: data.title,
                        videoId: data.id,
                        thumbnail: data.thumbnails?.[0]?.url || data.thumbnail || null,
                        duration: data.duration || 0
                    };
                } catch (err) { return null; }
            }).filter(Boolean);
        } catch (error) {
            throw new Error(`yt-dlp fallback search failed: ${error.message}`);
        }
    }
}

module.exports = new YtDlpService();
