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
    getCookiesContent() {
        if (require('fs').existsSync(this.cookiesPath)) {
            return require('fs').readFileSync(this.cookiesPath, 'utf8');
        }
        return null;
    }

    getHttpCookies() {
        const raw = this.getCookiesContent();
        if (!raw) return null;
        try {
            return raw.split('\n')
                .filter(l => l && !l.startsWith('#'))
                .map(l => {
                    const parts = l.split('\t');
                    if (parts.length < 7) return null;
                    return `${parts[5]}=${parts[6]}`;
                })
                .filter(Boolean)
                .join('; ');
        } catch (e) {
            return null;
        }
    }
    async searchVideos(query, limit = 10) {
        const startTime = Date.now();
        try {
            // First try yt-search (very fast)
            const r = await ytSearch(query);
            if (!r || !r.videos || r.videos.length === 0) throw new Error('yt-search returned no results');

            const videos = r.videos.slice(0, limit);
            return videos.map(video => ({
                title: video.title,
                videoId: video.videoId,
                thumbnail: video.thumbnail || video.image || null,
                duration: video.seconds || 0
            }));
        } catch (error) {
            logger.warn('yt-search failed, falling back to yt-dlp search', { query, error: error.message });
            return this.searchVideosYtDlp(query, limit);
        }
    }

    /**
     * Downloads the audio to a local file in /tmp for buffered streaming.
     * This ensures Range support for iOS.
     */
    async downloadToTmp(videoId) {
        const filePath = path.join(os.tmpdir(), `${videoId}.mp3`);

        // If file already exists, just return the path
        const fs = require('fs');
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 10000) return filePath; // Avoid returning empty/broken files
        }

        const streamUrl = await this.extractAudioStream(videoId);

        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            // Use ffmpeg to transcode and save to temp file
            // -y overwrites existing (allows retry)
            const cmd = `ffmpeg -y -i "${streamUrl}" -f mp3 -acodec libmp3lame -ab 128k -ar 44100 "${filePath}"`;

            logger.info('Starting disk-buffered download', { videoId, filePath });

            exec(cmd, (error) => {
                if (error) {
                    logger.error('Buffer download failed', { videoId, error: error.message });
                    return reject(error);
                }
                logger.info('Buffer download complete', { videoId });
                resolve(filePath);
            });
        });
    }

    /**
     * Replaces all proxy logic with a single robust info extractor.
     * Returns the direct stream URL and total file size.
     */
    async getStreamInfo(videoId) {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const args = [
            '-f', 'bestaudio[ext=m4a]/bestaudio/best',
            '--get-url',
            '--get-filename',
            '--print', 'filesize',
            '--no-playlist',
            '--no-warnings'
        ];

        if (require('fs').existsSync(this.cookiesPath)) {
            args.push('--cookies', this.cookiesPath);
        }

        args.push(url);

        return new Promise((resolve, reject) => {
            const { execFile } = require('child_process');
            execFile(this.binPath, args, (error, stdout, stderr) => {
                if (error) {
                    logger.error('yt-dlp info extraction failed', { videoId, error: stderr || error.message });
                    return reject(new Error('Stream extraction failed'));
                }

                const lines = stdout.trim().split('\n');
                // Expected output:
                // [stream_url]
                // [filename]
                // [filesize]
                const streamUrl = lines[0];
                const size = parseInt(lines[lines.length - 1]);

                if (!streamUrl || isNaN(size)) {
                    return reject(new Error('Incomplete stream info'));
                }

                resolve({ url: streamUrl, size });
            });
        });
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
