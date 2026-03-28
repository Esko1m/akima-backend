const logger = require('../utils/logger');

/**
 * Service to handle extraction via Cobalt API.
 * This is an extremely robust fallback that often bypasses bot detection 
 * that simple scrapers cannot handle.
 */
class CobaltService {
    constructor() {
        this.apiUrl = 'https://api.cobalt.tools/api/json';
    }

    async extractAudioStream(videoId) {
        const startTime = Date.now();
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        try {
            logger.info('Attempting Cobalt extraction', { videoId });

            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Origin': 'https://cobalt.tools',
                    'Referer': 'https://cobalt.tools/'
                },
                body: JSON.stringify({
                    url: videoUrl,
                    isAudioOnly: true,
                    aFormat: 'best'
                })
            });

            const data = await response.json();

            if (data.status === 'stream' && data.url) {
                const execTime = Date.now() - startTime;
                logger.info('Cobalt extraction succeeded', { videoId, execTime });
                return data.url;
            }

            if (data.status === 'error') {
                throw new Error(`Cobalt returned error: ${data.text || 'Unknown Cobalt error'}`);
            }

            throw new Error(`Cobalt returned unexpected status: ${data.status}`);
        } catch (error) {
            logger.error('Cobalt extraction failed', { videoId, error: error.message });
            throw error;
        }
    }
}

module.exports = new CobaltService();
