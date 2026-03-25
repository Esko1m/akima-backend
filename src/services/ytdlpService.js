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
 * Optimized for both local (yt-dlp) and Vercel (JS-based) environments.
 */
class YtDlpService {
    constructor() {
        // Path to local yt-dlp binary for local fallback
        this.binPath = os.platform() === 'win32'
            ? path.resolve(__dirname, '../../yt-dlp.exe')
            : 'yt-dlp';

        // Flag to check if we are on Vercel or similar serverless env
        this.isServerless = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    }

    /**
     * Search for videos using yt-search (JS-based, serverless friendly)
     * @param {string} query 
     * @param {number} limit 
     * @returns {Promise<Array>}
     */
    async searchVideos(query, limit = 10) {
        const startTime = Date.now();
        try {
            logger.info('Starting JS-based search', { query, limit });

            const r = await ytSearch(query);
            const videos = r.videos.slice(0, limit);

            const results = videos.map(video => ({
                title: video.title,
                videoId: video.videoId,
                thumbnail: video.thumbnail || video.image || null,
                duration: video.seconds || 0
            }));

            const execTime = Date.now() - startTime;
            logger.info('JS search executed successfully', { query, execTime, resultsCount: results.length });

            return results;
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('JS search failed', { query, execTime, error: error.message });

            // Fallback to yt-dlp if local binary exists and JS search fails
            if (!this.isServerless) {
                logger.info('Attempting yt-dlp search fallback...');
                return this.searchVideosYtDlp(query, limit);
            }

            throw new Error(`Search failed: ${error.message}`);
        }
    }

    /**
     * Legacy yt-dlp search (kept for local robustness)
     */
    async searchVideosYtDlp(query, limit = 5) {
        const getArgs = (searchPrefix) => [
            `${searchPrefix}${limit}:${query}`,
            '--dump-json',
            '--no-warnings',
            '--flat-playlist'
        ];

        try {
            const ytPromise = execFileAsync(this.binPath, getArgs('ytsearch'));
            const [ytResult] = await Promise.allSettled([ytPromise]);

            let combinedStdout = '';
            if (ytResult.status === 'fulfilled') combinedStdout += ytResult.value.stdout + '\n';

            const lines = combinedStdout.trim().split('\n');
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
            throw new Error(`yt-dlp fallback failed: ${error.message}`);
        }
    }

    /**
     * Extract direct playback stream URL using play-dl (JS-based)
     * @param {string} videoId 
     * @returns {Promise<string>}
     */
    async extractAudioStream(videoId) {
        const startTime = Date.now();
        try {
            logger.info('Extracting stream via play-dl', { videoId });

            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

            // play-dl.stream() gives us a stream object which often contains the URL
            // or we can use video_info
            const info = await play.video_info(videoUrl);
            const stream = await play.stream_from_info(info, { quality: 2 }); // quality 2 is often bestaudio

            if (stream && stream.url) {
                logger.info('play-dl stream extracted', { videoId, execTime: Date.now() - startTime });
                return stream.url;
            }

            throw new Error('No stream URL found in play-dl output');
        } catch (error) {
            logger.warn('play-dl extraction failed, falling back to yt-dlp', { videoId, error: error.message });

            // Fallback to yt-dlp if possible
            return this.extractAudioStreamYtDlp(videoId);
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
            logger.error('yt-dlp extraction failed', { videoId, error: error.message });
            throw new Error(`Stream extraction failed: ${error.message}`);
        }
    }
}

module.exports = new YtDlpService();
