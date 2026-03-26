const ytSearch = require('yt-search');
const logger = require('../utils/logger');
const ytdl = require('@distube/ytdl-core');

/**
 * Service to handle YouTube search and stream extraction.
 * Optimized for Vercel Serverless using a pure Javascript implementation (@distube/ytdl-core).
 */
class YtDlpService {
    constructor() {
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
     * Extract direct playback stream URL using @distube/ytdl-core.
     * This pure JS method is essential for Vercel/Serverless where .exe binaries cannot execute.
     */
    async extractAudioStream(videoId) {
        const startTime = Date.now();
        const url = `https://www.youtube.com/watch?v=${videoId}`;

        logger.info('Executing ytdl-core JS extraction', { videoId });

        try {
            const info = await ytdl.getInfo(url);
            const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

            // Try to find the m4a high bitrate or fallback
            let format = audioFormats.find(f => f.hasAudio && !f.hasVideo && f.container === 'mp4' && f.audioBitrate >= 128);
            if (!format) format = audioFormats.find(f => f.hasAudio && !f.hasVideo && f.container === 'mp4');
            if (!format) format = audioFormats[0];

            if (format && format.url) {
                const execTime = Date.now() - startTime;
                logger.info('ytdl-core extraction succeeded', { videoId, execTime, bitrate: format.audioBitrate });
                return format.url;
            }

            throw new Error('ytdl-core returned no valid audio format URLs');
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('ytdl-core extraction failed', { videoId, execTime, error: error.message });
            throw new Error(`ytdl-core fallback extraction failed: ${error.message}`);
        }
    }

    /**
     * Backup yt-search
     */
    async searchVideosYtDlp(query, limit = 5) {
        try {
            if (!r || !r.videos) return [];
            return r.videos.slice(0, limit).map(v => ({
                title: v.title,
                videoId: v.videoId,
                thumbnail: v.thumbnail || v.image || null,
                duration: v.seconds || 0
            }));
        } catch (error) {
            throw new Error(`yt-search pure fallback failed: ${error.message}`);
        }
    }
}

module.exports = new YtDlpService();
