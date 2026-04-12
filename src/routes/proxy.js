const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const logger = require('../utils/logger');

const COOKIES_PATH = path.join(__dirname, '../../yt-cookies.txt');
const YTDLP_PATH = path.join(__dirname, '../../yt-dlp.exe');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * ROBUST RANGE PROXY v5 (Omega):
 * 1. Layered Extraction: Local (Cookies) -> Local (Android Spoof) -> Invidious Scraper (Nadeko).
 * 2. On-the-fly Fallback: Automatically tries the next extraction strategy if streaming yields a 403/429.
 * 3. Consistent UA and Referer tracking.
 */
router.get('/', async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) return res.status(400).send('ID required');

    logger.info('Proxy: Starting extraction chain', { videoId });

    // --- Strategy 1: Invidious Scraper (Nadeko) ---
    const scrapeInvidious = async (id) => {
        try {
            logger.info('Proxy: Attempting Invidious Scrape (Nadeko)', { videoId: id });
            const response = await fetch(`https://inv.nadeko.net/watch?v=${id}`, {
                headers: { 'User-Agent': UA }
            });
            const html = await response.text();

            // Look for adaptive_formats in the page source
            const match = html.match(/\"adaptive_formats\":\[(.*?)\]/);
            if (match) {
                const formats = JSON.parse('[' + match[1] + ']');
                const audio = formats
                    .filter(f => f.type && f.type.startsWith('audio'))
                    .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0))[0];

                if (audio && audio.url) {
                    logger.info('Proxy: Invidious Scrape OK', { videoId: id });
                    return audio.url;
                }
            }
            logger.warn('Proxy: Invidious Scrape failed to find audio', { videoId: id });
        } catch (err) {
            logger.error('Proxy: Invidious Scrape error', { videoId: id, error: err.message });
        }
        return null;
    };

    // --- Strategy 2: Local yt-dlp ---
    const extractWithYtdlp = (useAndroidClient = false) => {
        return new Promise((resolve) => {
            if (!fs.existsSync(YTDLP_PATH)) return resolve(null);

            const args = [
                '--no-check-certificates',
                '--extractor-args', 'youtube:skip=dash',
                '-f', 'bestaudio[ext=m4a]/bestaudio',
                '--force-ipv4',
                '--get-url',
                `https://www.youtube.com/watch?v=${videoId}`
            ];

            if (useAndroidClient) {
                args.push('--extractor-args', 'youtube:player_client=android_embedded,web');
                args.push('--user-agent', 'com.google.android.youtube/19.05.36 (Linux; Android 14; Pixel 8 Pro)');
            } else {
                args.push('--user-agent', UA);
                if (fs.existsSync(COOKIES_PATH)) {
                    args.push('--cookies', COOKIES_PATH);
                }
            }

            const ytdlp = spawn(YTDLP_PATH, args);
            let stdout = '';
            ytdlp.stdout.on('data', (data) => stdout += data.toString());
            ytdlp.on('close', (code) => {
                if (code !== 0 || !stdout.trim()) return resolve(null);
                resolve(stdout.trim());
            });
        });
    };

    const strategies = [
        { name: 'local-cookies', run: () => extractWithYtdlp(false), ua: UA },
        { name: 'local-android', run: () => extractWithYtdlp(true), ua: 'com.google.android.youtube/19.05.36 (Linux; Android 14; Pixel 8 Pro)' },
        { name: 'invidious-scrape', run: () => scrapeInvidious(videoId), ua: UA }
    ];

    const streamResponse = (url, ua, strategyIdx) => {
        return new Promise((resolve) => {
            let currentYtReq = null;
            const headers = { 'User-Agent': ua, 'Referer': 'https://www.youtube.com/' };
            if (req.headers.range) headers['Range'] = req.headers.range;

            const client = url.startsWith('https') ? https : http;
            currentYtReq = client.get(url, { headers }, (ytRes) => {
                // If we get a 403 or 429, we handle it as a failure to trigger next strategy
                if ((ytRes.statusCode === 403 || ytRes.statusCode === 429) && strategyIdx < strategies.length - 1) {
                    logger.warn(`Proxy: Strategy ${strategies[strategyIdx].name} gave ${ytRes.statusCode}, failing over...`);
                    ytReqDestroy();
                    return resolve(false);
                }

                // Handle Redirects
                if (ytRes.statusCode >= 300 && ytRes.statusCode < 400 && ytRes.headers.location) {
                    ytReqDestroy();
                    return resolve(streamResponse(ytRes.headers.location, ua, strategyIdx));
                }

                // Final stream reached
                res.status(ytRes.statusCode);
                const responseHeaders = {
                    'Content-Type': ytRes.headers['content-type'] || 'audio/mp4',
                    'Access-Control-Allow-Origin': '*',
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public, max-age=3600'
                };
                if (ytRes.headers['content-range']) responseHeaders['Content-Range'] = ytRes.headers['content-range'];
                if (ytRes.headers['content-length']) responseHeaders['Content-Length'] = ytRes.headers['content-length'];
                res.set(responseHeaders);
                ytRes.pipe(res);
                ytRes.on('error', () => { res.end(); resolve(true); });
                resolve(true);
            });

            currentYtReq.on('error', (err) => {
                logger.error('Proxy: Request error', { error: err.message });
                if (!res.headersSent) resolve(false);
            });

            const ytReqDestroy = () => { if (currentYtReq) currentYtReq.destroy(); };
            req.on('close', ytReqDestroy);
        });
    };

    // --- Main Execution Loop ---
    for (let i = 0; i < strategies.length; i++) {
        const strat = strategies[i];
        try {
            const url = await strat.run();
            if (url) {
                logger.info(`Proxy: Extraction success (${strat.name}), starting stream`, { videoId });
                const success = await streamResponse(url, strat.ua, i);
                if (success) return; // Finished!
            }
        } catch (err) {
            logger.error(`Proxy: Unexpected error in strategy ${strat.name}`, { error: err.message });
        }
    }

    if (!res.headersSent) {
        logger.error('Proxy: All strategies exhausted', { videoId });
        res.status(500).send('Playback failed - All strategies exhausted');
    }
});

module.exports = router;
