const ytSearch = require('yt-search');
const play = require('play-dl');
const logger = require('../utils/logger');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const os = require('os');
const path = require('path');

/**
 * Service to handle YouTube search and stream extraction.
 * Optimized for Vercel (JS-based) with local (yt-dlp) fallback.
 */
class YtDlpService {
    constructor() {
        this.binPath = os.platform() === 'win32'
            ? path.resolve(__dirname, '../../yt-dlp.exe')
            : 'yt-dlp';

        // VERCEL=1 is set by Vercel in production
        this.isServerless = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    }

    /**
     * Search for videos using yt-search (JS-based)
     */
    async searchVideos(query, limit = 10) {
        const startTime = Date.now();
        try {
            logger.info('Vercel Search Attempt', { query, limit });

            const r = await ytSearch(query);
            if (!r || !r.videos) throw new Error('No videos returned from yt-search');

            const videos = r.videos.slice(0, limit);
            const results = videos.map(video => ({
                title: video.title,
                videoId: video.videoId,
                thumbnail: video.thumbnail || video.image || null,
                duration: video.seconds || 0
            }));

            const execTime = Date.now() - startTime;
            logger.info('Vercel Search Succeeded', { query, execTime, count: results.length });

            return results;
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('Vercel Search Failed', { query, execTime, error: error.message });

            if (!this.isServerless) {
                logger.info('Falling back to local yt-dlp search');
                return this.searchVideosYtDlp(query, limit);
            }
            throw new Error(`Search failed: ${error.message}`);
        }
    }

    /**
     * Extract direct playback stream URL using play-dl (JS-based)
     */
    async extractAudioStream(videoId) {
        const startTime = Date.now();
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        try {
            logger.info('Vercel Extraction Attempt', { videoId });

            // Set User-Agent to something common to avoid blocking
            // play-dl handles this internally but we can try to be more robust
            const info = await play.video_info(videoUrl);

            if (!info || !info.format) {
                throw new Error('Could not retrieve video information from play-dl');
            }

            // Refined selection: filter out non-HTTP URLs if any, and prefer audio/m4a
            const format = info.format.find(f => f.hasAudio && !f.hasVideo && f.container === 'm4a' && f.url)
                || info.format.find(f => f.hasAudio && !f.hasVideo && f.url)
                || info.format.find(f => f.hasAudio && f.url);

            if (format && format.url) {
                const execTime = Date.now() - startTime;
                logger.info('Vercel Extraction Succeeded', { videoId, execTime });
                return format.url;
            }

            throw new Error('No playable audio format found with a valid URL');
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('Vercel Extraction Failed', { videoId, execTime, error: error.message });

            if (!this.isServerless) {
                logger.info('Falling back to local yt-dlp extraction');
                return this.extractAudioStreamYtDlp(videoId);
            }

            throw new Error(`Stream extraction failed: ${error.message}`);
        }
    }

    /**
     * Legacy yt-dlp search
     */
    async searchVideosYtDlp(query, limit = 5) {
        const getArgs = (searchPrefix) => [
            `${searchPrefix}${limit}:${query}`,
            '--dump-json',
            '--no-warnings',
            '--flat-playlist'
        ];

        try {
            const { stdout } = await execFileAsync(this.binPath, getArgs('ytsearch'));
            const lines = stdout.trim().split('\n');
            const seenIds = new Set();
            return lines.map(line => {
                if (!line) return null;
                try {
                    const data = JSON.parse(line);
                    if (seenIds.has(data.id)) return null;
                    seenIds.add(data.id);
                    return {
                        title: data.title, videoId: data.id,
                        thumbnail: data.thumbnails?.[0]?.url || data.thumbnail || null,
                        duration: data.duration || 0
                    };
                } catch (err) { return null; }
            }).filter(Boolean);
        } catch (error) {
            throw new Error(`yt-dlp fallback failed: ${error.message}`);
        }
    }

    /**
     * Legacy yt-dlp extraction
     */
    async extractAudioStreamYtDlp(videoId) {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const args = ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '-g', '--no-warnings', '--no-check-certificates', '--rm-cache-dir', url];
        try {
            const { stdout } = await execFileAsync(this.binPath, args);
            const firstUrl = (stdout || '').split('\n')[0].trim();
            if (firstUrl) return firstUrl;
            throw new Error('yt-dlp returned empty stdout');
        } catch (error) {
            throw new Error(`yt-dlp extraction failed: ${error.message}`);
        }
    }
}

module.exports = new YtDlpService();
