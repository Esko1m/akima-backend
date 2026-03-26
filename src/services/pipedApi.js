const logger = require('../utils/logger');
const https = require('https');

const PIPED_INSTANCES = [
    'https://api.piped.projectsegfau.lt',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.smnz.de',
    'https://pipedapi.kavin.rocks'
];

class PipedApi {
    constructor() {
        this.currentIndex = 0;
    }

    _getInstanceUrl() {
        const url = PIPED_INSTANCES[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % PIPED_INSTANCES.length;
        return url;
    }

    async getStream(videoId, attempt = 1) {
        if (attempt > PIPED_INSTANCES.length) {
            throw new Error('All Piped instances failed to fetch stream');
        }

        const baseUrl = this._getInstanceUrl();
        const url = `${baseUrl}/streams/${videoId}`;

        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', async () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const json = JSON.parse(data);
                            if (!json.audioStreams || json.audioStreams.length === 0) {
                                throw new Error('No audio streams found'); // Throw to trigger fallback
                            }

                            // Harmony logic: prefer mp4a (m4a) high bitrate
                            // `itag == 140` is m4a 128kbps, `251` is opus 160kbps
                            let bestStream = json.audioStreams.find(s => s.itag === 140);
                            if (!bestStream) {
                                bestStream = json.audioStreams.find(s => s.codec === 'mp4a.40.2') || json.audioStreams[0];
                            }

                            if (bestStream && bestStream.url) {
                                resolve({ url: bestStream.url, size: bestStream.contentLength });
                            } else {
                                throw new Error('No valid playable URL found');
                            }
                        } catch (e) {
                            logger.warn(`Piped instance ${baseUrl} failed parsing: ${e.message}`);
                            try {
                                const fallbackUrl = await this.getStream(videoId, attempt + 1);
                                resolve(fallbackUrl);
                            } catch (fallbackError) {
                                reject(fallbackError);
                            }
                        }
                    } else {
                        logger.warn(`Piped instance ${baseUrl} failed: ${res.statusCode}`);
                        try {
                            // Try the next instance
                            const fallbackUrl = await this.getStream(videoId, attempt + 1);
                            resolve(fallbackUrl);
                        } catch (e) {
                            reject(e);
                        }
                    }
                });
            }).on('error', async (error) => {
                logger.warn(`Piped instance ${baseUrl} error: ${error.message}`);
                try {
                    // Try the next instance
                    const fallbackUrl = await this.getStream(videoId, attempt + 1);
                    resolve(fallbackUrl);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}

module.exports = new PipedApi();
