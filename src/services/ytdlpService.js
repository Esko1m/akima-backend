const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const logger = require('../utils/logger');

/**
 * Service to encapsulate binary execution of yt-dlp.
 */
class YtDlpService {
    constructor() {
        const os = require('os');
        const path = require('path');

        // Use local .exe for Windows dev, and global binary for Render's Linux Docker
        this.binPath = os.platform() === 'win32'
            ? path.resolve(__dirname, '../../yt-dlp.exe')
            : 'yt-dlp';
    }

    /**
     * Search for videos using ytsearch:
     * @param {string} query 
     * @param {number} limit 
     * @returns {Promise<Array>}
     */
    async searchVideos(query, limit = 5) {
        const startTime = Date.now();
        try {
            const getArgs = (searchPrefix) => [
                `${searchPrefix}${limit}:${query}`,
                '--dump-json',
                '--no-warnings',
                '--flat-playlist'
            ];

            // Execute both standard YouTube and YouTube Music searches
            const ytPromise = execFileAsync(this.binPath, getArgs('ytsearch'));
            const ytmPromise = execFileAsync(this.binPath, getArgs('ytmsearch'));

            const [ytResult, ytmResult] = await Promise.allSettled([ytPromise, ytmPromise]);

            let combinedStdout = '';
            if (ytResult.status === 'fulfilled') combinedStdout += ytResult.value.stdout + '\n';
            if (ytmResult.status === 'fulfilled') combinedStdout += ytmResult.value.stdout + '\n';

            // Parse multi-line JSON output
            const lines = combinedStdout.trim().split('\n');
            const seenIds = new Set();

            const results = lines.map(line => {
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
                } catch (err) {
                    logger.warn('Failed to parse a line from yt-dlp search', { line });
                    return null;
                }
            }).filter(Boolean); // Filter invalid lines and duplicates

            const execTime = Date.now() - startTime;
            logger.info('yt-dlp combined search executed', { query, execTime, resultsCount: results.length });

            return results;
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('yt-dlp combined search failed', { query, execTime, error: error.message });
            throw new Error(`Search failed to execute: ${error.message}`);
        }
    }

    /**
     * Extract direct playback stream URL (audio only if possible)
     * @param {string} videoId 
     * @returns {Promise<string>}
     */
    async extractAudioStream(videoId) {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const args = ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '-g', '--no-warnings', '--no-check-certificates', '--rm-cache-dir', url];

        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
            const startTime = Date.now();
            try {
                const { stdout } = await execFileAsync(this.binPath, args);
                const streamUrl = (stdout || '').trim();
                const firstUrl = streamUrl.split('\n')[0].trim();

                if (firstUrl) {
                    logger.info('yt-dlp stream extracted', { videoId, attempt, execTime: Date.now() - startTime });
                    return firstUrl;
                }
            } catch (error) {
                lastError = error;
                logger.warn('yt-dlp extraction attempt failed', { videoId, attempt, error: error.message });
                if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
            }
        }

        logger.error('yt-dlp stream extraction completely failed', {
            videoId,
            error: lastError?.message,
            stderr: lastError?.stderr
        });
        throw new Error(`Stream extraction failed: ${lastError?.message}`);
    }
}

module.exports = new YtDlpService();
