const https = require('https');
const logger = require('../utils/logger');

// More stable list of Piped instances
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.official-halal.top',
    'https://pipedapi.astoria.rocks'
];

class PipedApi {
    constructor() {
        this.instances = PIPED_INSTANCES;
        this.currentIndex = 0;
    }

    async getStream(videoId, attempt = 1) {
        if (attempt > this.instances.length) return null;

        const baseUrl = this.instances[this.currentIndex % this.instances.length];
        this.currentIndex++;
        const url = `${baseUrl}/api/v1/videos/${videoId}`;

        return new Promise((resolve) => {
            const req = https.get(url, {
                timeout: 8000
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const json = JSON.parse(data);
                            const audioStreams = (json.audioStreams || []).filter(s => s.mimeType && s.mimeType.includes('audio'));
                            // Use simple selection
                            const bestStream = audioStreams.find(s => s.itag === '251') ||
                                audioStreams.find(s => s.codec === 'opus') ||
                                audioStreams[0];
                            if (bestStream && bestStream.url) resolve({ url: bestStream.url });
                            else resolve(this.getStream(videoId, attempt + 1));
                        } catch (e) {
                            resolve(this.getStream(videoId, attempt + 1));
                        }
                    } else {
                        resolve(this.getStream(videoId, attempt + 1));
                    }
                });
            });

            req.on('error', (err) => {
                logger.warn(`Piped instance ${baseUrl} failed: ${err.message}`);
                resolve(this.getStream(videoId, attempt + 1));
            });

            req.setTimeout(8000, () => {
                req.destroy();
                resolve(this.getStream(videoId, attempt + 1));
            });
        });
    }
}

module.exports = new PipedApi();
