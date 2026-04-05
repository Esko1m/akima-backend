const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const logger = require('../utils/logger');

const YTDLP_PATH = path.join(__dirname, '../../yt-dlp.exe');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * ROBUST RANGE PROXY v2 (Final):
 * 1. Consistent User-Agent (UA) for extraction and streaming.
 * 2. Full Byte-Range support (mandatory for iOS).
 * 3. Protocol-agnostic (handles http/https from extraction).
 * 4. Automatic MIME type mapping.
 */
router.get('/', async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) return res.status(400).send('ID required');

    logger.info('Proxy: Starting extraction', { videoId });

    if (!fs.existsSync(YTDLP_PATH)) {
        logger.error('yt-dlp binary missing', { path: YTDLP_PATH });
        return res.status(500).send('Extraction failed');
    }

    const args = [
        '--no-check-certificates',
        '--extractor-args', 'youtube:skip=dash',
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        '--user-agent', UA,
        '--get-url',
        `https://www.youtube.com/watch?v=${videoId}`
    ];

    const ytdlp = spawn(YTDLP_PATH, args);

    let streamUrl = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => streamUrl += data.toString());
    ytdlp.stderr.on('data', (data) => stderr += data.toString());

    ytdlp.on('close', (code) => {
        if (code !== 0 || !streamUrl.trim()) {
            logger.error('Extraction failed', { videoId, code, stderr: stderr.trim() });
            return res.status(500).send('Extraction failed');
        }

        streamUrl = streamUrl.trim();
        logger.info('Extraction OK, proxying', { videoId, url: streamUrl.substring(0, 50) + '...' });

        const headers = { 'User-Agent': UA };
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
            logger.info('Range header forwarded', { videoId, range: req.headers.range });
        }

        const client = streamUrl.startsWith('https') ? https : http;
        const ytReq = client.get(streamUrl, { headers }, (ytRes) => {
            logger.info('YouTube response', { videoId, status: ytRes.statusCode, type: ytRes.headers['content-type'] });

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

            ytRes.on('error', (err) => {
                logger.error('Stream error', { videoId, error: err.message });
                res.end();
            });
        });

        ytReq.on('error', (err) => {
            logger.error('Request error', { videoId, error: err.message });
            res.status(500).send('Stream error');
        });

        req.on('close', () => {
            ytReq.destroy();
        });
    });
});

module.exports = router;
