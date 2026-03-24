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
            // ytsearch<N> for faster results without downloading the full page
            const args = [
                `ytsearch${limit}:${query}`,
                '--dump-json',
                '--no-warnings',
                '--flat-playlist'
            ];

            const { stdout } = await execFileAsync(this.binPath, args);

            // Parse multi-line JSON output
            const lines = stdout.trim().split('\n');
            const results = lines.map(line => {
                try {
                    const data = JSON.parse(line);
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
            }).filter(Boolean); // Filter invalid lines

            const execTime = Date.now() - startTime;
            logger.info('yt-dlp search executed', { query, execTime, resultsCount: results.length });

            return results;
        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('yt-dlp search failed', { query, execTime, error: error.message });
            throw new Error(`Search failed to execute: ${error.message}`);
        }
    }

    /**
     * Extract direct playback stream URL (audio only if possible)
     * @param {string} videoId 
     * @returns {Promise<string>}
     */
    async extractAudioStream(videoId) {
        const startTime = Date.now();
        try {
            // -f bestaudio -g 
            const url = `https://www.youtube.com/watch?v=${videoId}`;
            const args = [
                '-f', 'bestaudio[ext=m4a]/bestaudio/best', // fallback chain
                '-g',
                '--no-warnings',
                url
            ];

            const { stdout } = await execFileAsync(this.binPath, args);
            const streamUrl = stdout.trim();

            const execTime = Date.now() - startTime;
            logger.info('yt-dlp stream extracted', { videoId, execTime });

            if (!streamUrl) {
                throw new Error('No stream URL returned by yt-dlp');
            }

            // Check if it returned multiple lines (sometimes it dumps video and audio links separately if format choice complex; best to take first)
            const firstUrl = streamUrl.split('\n')[0].trim();
            return firstUrl;

        } catch (error) {
            const execTime = Date.now() - startTime;
            logger.error('yt-dlp stream extraction failed', { videoId, execTime, error: error.message });
            throw new Error(`Stream extraction failed: ${error.message}`);
        }
    }
}

module.exports = new YtDlpService();
