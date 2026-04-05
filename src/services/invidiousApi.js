const logger = require('../utils/logger');
const https = require('https');

const INVIDIOUS_INSTANCES = [
    'https://yewtu.be',
    'https://inv.vern.cc',
    'https://invidious.snopyta.org',
    'https://invidious.namazso.eu'
];

class InvidiousApi {
    constructor() {
        this.instances = INVIDIOUS_INSTANCES;
        this.currentIndex = 0;
    }

    async getStream(videoId, attempt = 1) {
        if (attempt > this.instances.length) {
            return null; // Return null instead of throwing to prevent crashes
        }

        const baseUrl = this.instances[this.currentIndex % this.instances.length];
        this.currentIndex++;
        const url = `${baseUrl}/api/v1/videos/${videoId}`;

        return new Promise((resolve) => {
            const req = https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', async () => {
                    if (res.statusCode === 200) {
                        try {
                            const json = JSON.parse(data);
                            const formats = json.adaptiveFormats || [];
                            const audioStreams = formats.filter(f => f.type && f.type.includes('audio'));
                            const bestStream = audioStreams.find(s => s.encoding === 'opus' || s.container === 'webm') || audioStreams[0];
                            if (bestStream && bestStream.url) {
                                logger.info(`Invidious extraction succeeded from ${baseUrl}`);
                                resolve({ url: bestStream.url });
                            } else {
                                resolve(this.getStream(videoId, attempt + 1));
                            }
                        } catch (e) {
                            resolve(this.getStream(videoId, attempt + 1));
                        }
                    } else {
                        resolve(this.getStream(videoId, attempt + 1));
                    }
                });
            });

            req.on('error', () => {
                resolve(this.getStream(videoId, attempt + 1));
            });

            req.setTimeout(5000, () => {
                req.destroy();
                resolve(this.getStream(videoId, attempt + 1));
            });
        });
    }
}

module.exports = new InvidiousApi();
