const logger = require('../utils/logger');
const https = require('https');

const YOUTUBE_MUSIC_URL = 'https://music.youtube.com/youtubei/v1';

class YouTubeMusicApi {
    constructor() {
        this.context = {
            client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20231214.00.00',
                hl: 'en',
                gl: 'US'
            }
        };
    }

    async _sendRequest(endpoint, payload) {
        const url = `${YOUTUBE_MUSIC_URL}/${endpoint}?prettyPrint=false`;
        const data = JSON.stringify({
            context: this.context,
            ...payload
        });

        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
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
            // "search" endpoint payload
            const data = await this._sendRequest('search', { query });

            // Navigate the monstrous YouTube JSON response to find the song section
            // In a real robust app, this would use a series of safe optional navigations.
            const contents = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
            if (!contents) return [];

            const results = [];
            for (const section of contents) {
                const items = section?.musicShelfRenderer?.contents || section?.musicCardShelfRenderer?.contents;
                if (!items) continue;

                for (const item of items) {
                    const renderer = item.musicResponsiveListItemRenderer;
                    if (!renderer) continue;

                    // Extract Video ID
                    const videoId = renderer.playlistItemData?.videoId || renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
                    if (!videoId) continue; // Skip non-playable items like artists or albums

                    // Extract Title
                    const title = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;

                    // Extract Artist and Duration from second column
                    const runs = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];

                    let artist = 'Unknown Artist';
                    let durationStr = '0:00';

                    // Typical format: [Artist Name, " • ", Album Name, " • ", "3:45"]
                    const artistRun = runs.find(r => r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
                    if (artistRun) {
                        artist = artistRun.text;
                    }

                    const lastRun = runs[runs.length - 1];
                    if (lastRun && /^\d+:\d+/.test(lastRun.text)) {
                        durationStr = lastRun.text;
                    }

                    // Convert duration string to seconds
                    const durationParts = durationStr.split(':').reverse();
                    let durationSeconds = 0;
                    if (durationParts[0]) durationSeconds += parseInt(durationParts[0], 10);
                    if (durationParts[1]) durationSeconds += parseInt(durationParts[1], 10) * 60;
                    if (durationParts[2]) durationSeconds += parseInt(durationParts[2], 10) * 3600;

                    // Extract Thumbnail
                    const thumbnails = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
                    const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : null;

                    results.push({
                        videoId,
                        title,
                        artist,
                        thumbnail,
                        duration: durationSeconds
                    });
                }
            }

            return results;
        } catch (error) {
            logger.error('YouTubeMusicApi search error:', error);
            throw error;
        }
    }
}

module.exports = new YouTubeMusicApi();
