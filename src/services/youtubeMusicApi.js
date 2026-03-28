const logger = require('../utils/logger');
const https = require('https');
const fs = require('fs');
const path = require('path');

const YOUTUBE_MUSIC_URL = 'https://music.youtube.com/youtubei/v1';

class YouTubeMusicApi {
    constructor() {
        this.cookiesPath = path.join(process.cwd(), 'yt-cookies.txt');
        this.context = {
            client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20231214.00.00',
                hl: 'en',
                gl: 'US'
            }
        };
        this.cookies = this._loadCookies();
    }

    _loadCookies() {
        if (fs.existsSync(this.cookiesPath)) {
            try {
                const raw = fs.readFileSync(this.cookiesPath, 'utf8');
                return raw.split('\n')
                    .filter(l => l && !l.startsWith('#'))
                    .map(l => {
                        const parts = l.split('\t');
                        if (parts.length < 7) return null;
                        return `${parts[5]}=${parts[6]}`;
                    })
                    .filter(Boolean)
                    .join('; ');
            } catch (e) {
                logger.warn('Failed to parse cookies for YouTubeMusicApi', { error: e.message });
            }
        }
        return null;
    }

    async _sendRequest(endpoint, payload) {
        const url = `${YOUTUBE_MUSIC_URL}/${endpoint}?prettyPrint=false`;
        const data = JSON.stringify({
            context: this.context,
            ...payload
        });

        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        if (this.cookies) {
            headers['Cookie'] = this.cookies;
        }

        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'POST',
                headers: headers
            }, (res) => {
                let chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString();
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(body));
                        } catch (e) {
                            reject(new Error('Failed to parse YouTube Music API response'));
                        }
                    } else {
                        reject(new Error(`YouTube Music API error: ${res.statusCode} ${body}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    async search(query) {
        try {
            const data = await this._sendRequest('search', { query });
            const contents = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
            if (!contents) return [];

            const results = [];
            for (const section of contents) {
                const items = section?.musicShelfRenderer?.contents || section?.musicCardShelfRenderer?.contents;
                if (!items) continue;

                for (const item of items) {
                    const renderer = item.musicResponsiveListItemRenderer;
                    if (!renderer) continue;

                    const videoId = renderer.playlistItemData?.videoId || renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
                    if (!videoId) continue;

                    const title = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
                    const runs = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

                    let artist = 'Unknown Artist';
                    let durationStr = '0:00';

                    const artistRun = runs.find(r => r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
                    if (artistRun) artist = artistRun.text;

                    const lastRun = runs[runs.length - 1];
                    if (lastRun && /^\d+:\d+/.test(lastRun.text)) durationStr = lastRun.text;

                    const durationParts = durationStr.split(':').reverse();
                    let durationSeconds = 0;
                    if (durationParts[0]) durationSeconds += parseInt(durationParts[0], 10);
                    if (durationParts[1]) durationSeconds += parseInt(durationParts[1], 10) * 60;
                    if (durationParts[2]) durationSeconds += parseInt(durationParts[2], 10) * 3600;

                    const thumbnails = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
                    const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : null;

                    results.push({ videoId, title, artist, thumbnail, duration: durationSeconds });
                }
            }
            return results;
        } catch (error) {
            logger.error('YouTubeMusicApi search error:', error);
            throw error;
        }
    }

    async getPlayer(videoId) {
        try {
            const payload = {
                videoId,
                playbackContext: {
                    contentPlaybackContext: {
                        signatureTimestamp: 19700
                    }
                }
            };

            const data = await this._sendRequest('player', payload);

            if (!data || !data.streamingData) {
                logger.warn('InnerTube Player response missing streamingData', { videoId });
                throw new Error(data?.playabilityStatus?.reason || 'Failed to retrieve streaming data from InnerTube');
            }

            const formats = [
                ...(data.streamingData.formats || []),
                ...(data.streamingData.adaptiveFormats || [])
            ];

            // Filter for audio streams and prioritize 251 (Opus) then 140 (M4A)
            const audioFormats = formats.filter(f => f.mimeType && f.mimeType.includes('audio/'));
            let bestStream = audioFormats.find(f => f.itag === 251) ||
                audioFormats.find(f => f.itag === 140);

            if (!bestStream) {
                bestStream = audioFormats.find(f => f.mimeType?.includes('audio/mp4')) || audioFormats[0];
            }

            if (bestStream && bestStream.url) {
                return {
                    url: bestStream.url,
                    itag: bestStream.itag,
                    mimeType: bestStream.mimeType,
                    contentLength: bestStream.contentLength
                };
            }

            throw new Error('InnerTube returned restricted formats (signature required)');
        } catch (error) {
            logger.error('YouTubeMusicApi getPlayer error:', error);
            throw error;
        }
    }
}

module.exports = new YouTubeMusicApi();
