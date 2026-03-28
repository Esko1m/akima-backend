const ytSearch = require('yt-search');
const logger = require('../utils/logger');
const ytdl = require('@distube/ytdl-core');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Service to handle YouTube search and stream extraction.
 * Optimized for robustness with a binary yt-dlp fallback (for local/Windows) and @distube/ytdl-core (for serverless).
 */
class YtDlpService {
    constructor() {
        this.cookiesPath = path.join(process.cwd(), 'yt-cookies.txt');
        this.ytdlpPath = path.join(process.cwd(), 'yt-dlp.exe');
        this.agent = null;
        this._initAgent();
    }

    _initAgent() {
        if (fs.existsSync(this.cookiesPath)) {
            try {
                const cookiesText = fs.readFileSync(this.cookiesPath, 'utf8');
                const cookies = this._parseCookies(cookiesText);
                if (cookies.length > 0) {
                    this.agent = ytdl.createAgent(cookies);
                    logger.info(`Initialized ytdl-core agent with ${cookies.length} cookies`);
                }
            } catch (e) {
                logger.error('Failed to initialize ytdl agent from cookies', { error: e.message });
            }
        }
    }

    _parseCookies(text) {
        return text.split('\n')
            .filter(line => line.trim() && !line.startsWith('#'))
            .map(line => {
                const parts = line.split('\t');
                if (parts.length < 7) return null;
                return {
                    domain: parts[0],
                    expirationDate: parseInt(parts[4]),
                    path: parts[1],
                    name: parts[5],
                    value: parts[6],
                    secure: parts[3] === 'TRUE',
                    httpOnly: false // Netscape format doesn't explicitly track this
                };
            })
            .filter(Boolean);
    }

    /**
     * Search for videos using yt-search (JS-based, fast and rarely blocked)
     */
    async searchVideos(query, limit = 10) {
        const startTime = Date.now();
        try {
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
            logger.warn('yt-search failed', { query, error: error.message });
            return [];
        }
    }

    /**
     * Extract direct playback stream URL.
     * Tries yt-dlp.exe binary first (most robust), then @distube/ytdl-core JS.
     */
    async extractAudioStream(videoId) {
        const startTime = Date.now();
        const url = `https://www.youtube.com/watch?v=${videoId}`;

        // 1. Try robust yt-dlp binary if available (ideal for Windows/Local environments)
        if (fs.existsSync(this.ytdlpPath)) {
            logger.info('Executing robust yt-dlp binary extraction', { videoId });
            try {
                const streamUrl = await this._extractWithBinary(videoId);
                const execTime = Date.now() - startTime;
                logger.info('yt-dlp binary extraction succeeded', { videoId, execTime });
                return streamUrl;
            } catch (binaryError) {
                logger.warn('yt-dlp binary failed, falling back to JS extraction', { videoId, error: binaryError.message });
            }
        }

        // 2. Fallback to @distube/ytdl-core (pure JS, essential for Serverless/Vercel)
        logger.info('Executing ytdl-core JS extraction fallback', { videoId, hasAgent: !!this.agent });
        try {
            const options = this.agent ? { agent: this.agent } : {};
            const info = await ytdl.getInfo(url, options);
            const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

            // Harmony Music logic: prefer 251 (opus) or 140 (m4a)
            let format = audioFormats.find(f => f.itag === 251) ||
                audioFormats.find(f => f.itag === 140);

            if (!format) format = audioFormats.find(f => f.container === 'mp4' && f.audioBitrate >= 128);
            if (!format) format = audioFormats[0];

            if (format && format.url) {
                const execTime = Date.now() - startTime;
                logger.info('ytdl-core extraction succeeded', { videoId, execTime, itag: format.itag });
                return format.url;
            }
            throw new Error('ytdl-core returned no valid audio formats');
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('Full extraction pipeline failed', { videoId, execTime, error: error.message });
            throw new Error(`Extraction failed: ${error.message}`);
        }
    }

    /**
     * Internal helper to use the yt-dlp binary
     */
    _extractWithBinary(videoId) {
        return new Promise((resolve, reject) => {
            const cookiesArg = fs.existsSync(this.cookiesPath) ? `--cookies "${this.cookiesPath}"` : '';
            // Match Harmony logic: prefer 251 then 140
            const command = `"${this.ytdlpPath}" ${cookiesArg} -f "251/140/bestaudio" -g "https://www.youtube.com/watch?v=${videoId}"`;

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(stderr || error.message));
                }
                const url = stdout.trim();
                if (url && url.startsWith('http')) {
                    resolve(url);
                } else {
                    reject(new Error('yt-dlp returned invalid URL'));
                }
            });
        });
    }
}

module.exports = new YtDlpService();
