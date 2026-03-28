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
        this.instances = PIPED_INSTANCES;
        this.lastFetch = 0;
        this.currentIndex = 0;
    }

    async _getLiveInstances() {
        const now = Date.now();
        // Refresh instances every 30 minutes
        if (now - this.lastFetch < 30 * 60 * 1000 && this.instances.length > 0) {
            return this.instances;
        }

        try {
            const url = 'https://piped-instances.kavin.rocks/';
            return new Promise((resolve, reject) => {
                https.get(url, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const list = JSON.parse(data);
                            const active = list
                                .filter(i => i.api_url && i.api_url !== 'https://api.piped.private.coffee') // Skip problematic instance from logs
                                .map(i => i.api_url);

                            if (active.length > 0) {
                                this.instances = active;
                                this.lastFetch = now;
                                logger.info(`Refreshed Piped instance list: ${active.length} active instances`);
                            }
                            resolve(this.instances);
                        } catch (e) {
                            reject(e);
                        }
                    });
                }).on('error', reject);
            });
        } catch (error) {
            logger.warn('Failed to fetch live Piped instances, using defaults');
            return PIPED_INSTANCES;
        }
    }

    _getInstanceUrl(instances) {
        const url = instances[this.currentIndex % instances.length];
        this.currentIndex++;
        return url;
    }

    async getStream(videoId, attempt = 1) {
        const instances = await this._getLiveInstances();

        if (attempt > instances.length || attempt > 5) {
            throw new Error('All Piped instances failed or reached max attempts');
        }

        const baseUrl = this._getInstanceUrl(instances);
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

                            // Harmony Music logic: prefer high-quality Opus (251) or M4A (140)
                            // 251: opus @ ~160kbps, 140: m4a @ ~128kbps
                            let bestStream = json.audioStreams.find(s => s.itag === 251) ||
                                json.audioStreams.find(s => s.itag === 140);

                            if (!bestStream) {
                                // Fallback to any mp4a or first available stream
                                bestStream = json.audioStreams.find(s => s.codec && s.codec.includes('mp4a')) ||
                                    json.audioStreams[0];
                            }

                            if (bestStream && bestStream.url) {
                                logger.info(`Successfully extracted stream from ${baseUrl}`, {
                                    videoId,
                                    itag: bestStream.itag,
                                    codec: bestStream.codec
                                });
                                resolve({
                                    url: bestStream.url,
                                    size: bestStream.contentLength,
                                    itag: bestStream.itag
                                });
                            } else {
                                throw new Error('No valid playable URL found in Piped response');
                            }
                        } catch (e) {
                            logger.warn(`Piped instance ${baseUrl} failed: ${e.message}`);
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
