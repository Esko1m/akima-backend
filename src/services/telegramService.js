const logger = require('../utils/logger');
const cacheService = require('./cacheService');
const songModel = require('../models/songModel');
const https = require('https');

class TelegramService {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = process.env.TELEGRAM_CHANNEL_ID;
        this.apiUrl = `https://api.telegram.org/bot${this.token}`;

        if (!this.token) {
            logger.error('TELEGRAM_BOT_TOKEN is missing in environment variables');
        } else {
            logger.info('Telegram Bot Token loaded', { prefix: this.token.substring(0, 10) + '...' });
        }

        // Workaround for SSL/TLS trust issues in this environment
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    async _get(url) {
        if (!url || url.includes('botundefined') || url.includes('botnull')) {
            throw new Error('Telegram Bot Token is missing or malformed');
        }
        return new Promise((resolve, reject) => {
            const options = {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                rejectUnauthorized: false
            };

            https.get(url, options, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    logger.info('Following redirect', { location: res.headers.location });
                    return resolve(this._get(res.headers.location));
                }

                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP Error ${res.statusCode}: ${body}`));
                    } else {
                        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                    }
                });
            }).on('error', reject);
        });
    }

    /**
     * Fetch file path from Telegram and cache it
     */
    async getDirectUrl(fileId) {
        const cacheKey = `tg_file:${fileId}`;
        const cachedPath = cacheService.get(cacheKey);

        let filePath = cachedPath;

        if (!filePath) {
            logger.info('Fetching file path from Telegram', { fileId });
            const data = await this._get(`${this.apiUrl}/getFile?file_id=${fileId}`);

            if (!data.ok) {
                throw new Error(`Telegram API Error: ${data.description}`);
            }

            filePath = data.result.file_path;
            // Cache for 1 hour as required
            cacheService.set(cacheKey, filePath, 3600);
        }

        return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    }

    /**
     * Basic sync logic using getUpdates. 
     * Note: Bot must be admin in channel to receive posts.
     */
    async syncFromUpdates() {
        try {
            logger.info('Syncing songs from Telegram updates...', { url: `${this.apiUrl}/getUpdates` });
            const data = await this._get(`${this.apiUrl}/getUpdates`);

            if (!data.ok) throw new Error(data.description);

            const songs = data.result
                .filter(u => (u.channel_post && u.channel_post.audio) || (u.message && u.message.audio))
                .map(u => {
                    const msg = u.channel_post || u.message;
                    const audio = msg.audio;
                    return {
                        id: `tg_${msg.message_id}`,
                        title: audio.title || audio.file_name || 'Unknown Title',
                        artist: audio.performer || 'Unknown Artist',
                        message_id: msg.message_id,
                        file_id: audio.file_id,
                        duration: audio.duration,
                        thumbnail: audio.thumb?.file_id || null
                    };
                });

            const addedCount = await songModel.updateSongs(songs);
            if (addedCount > 0) {
                logger.info(`Synced ${addedCount} new songs from Telegram`);
            }
            return addedCount;
        } catch (error) {
            logger.error('Telegram sync failed', { error: error.message });
            return 0;
        }
    }
}

module.exports = new TelegramService();
