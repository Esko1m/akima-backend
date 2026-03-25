const express = require('express');
const router = express.Router();
const z = require('zod');
const ytdlpService = require('../services/ytdlpService');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

// Validator ensuring ID conforms roughly to video ID formatting limits
const streamSchema = z.object({
    id: z.string().min(5, "Video ID too short").max(20, "Video ID too long").regex(/^[a-zA-Z0-9_-]+$/, "Invalid Video ID format"),
});

router.get('/', async (req, res) => {
    try {
        // Validate request parameter
        const validated = streamSchema.parse(req.query);
        const videoId = validated.id;

        // Stream URLs change format and contain expiration timestamps from Google Servers
        // so we set TTL slightly smaller than expiry time provided natively to be safe
        const cacheKey = `stream:${videoId}`;
        // Temporarily bypass cache to debug extraction issues
        // const cachedStreamUrl = cacheService.get(cacheKey);
        // if (cachedStreamUrl) { return res.json({ stream: cachedStreamUrl }); }

        // Fetch stream from service wrapper
        // Instead of returning the raw YouTube URL (which is IP-locked),
        // we return a link to our own proxy endpoint.
        const proxyUrl = `https://${req.get('host')}/stream/proxy?id=${videoId}`;

        return res.json({ stream: proxyUrl });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
        }
        logger.error('Stream API Error', { error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// New Proxy Endpoint: Actually pipes the data from yt-dlp to the client
router.get('/proxy', async (req, res) => {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).send("ID required");

        logger.info('Proxying stream requested (ytdl-core)', { id });

        const cookies = ytdlpService.getHttpCookies();
        const ytdl = require('@distube/ytdl-core');

        const options = {
            filter: 'audioonly',
            quality: 'lowestaudio', // Faster startup for limited servers
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        };

        if (cookies) {
            options.requestOptions.headers['Cookie'] = cookies;
        }

        if (req.headers.range) {
            options.range = {
                start: parseInt(req.headers.range.replace('bytes=', '').split('-')[0]) || 0
            };
            logger.info('Forwarding range request via ytdl-core', { id, range: req.headers.range });
        }

        const stream = ytdl(`https://www.youtube.com/watch?v=${id}`, options);

        stream.on('response', (response) => {
            // Relay status and essential headers
            res.status(response.statusCode);
            res.setHeader('Content-Type', 'audio/mp4');
            res.setHeader('Accept-Ranges', 'bytes');

            if (response.headers['content-range']) {
                res.setHeader('Content-Range', response.headers['content-range']);
            }
            if (response.headers['content-length']) {
                res.setHeader('Content-Length', response.headers['content-length']);
            }
        });

        stream.pipe(res);

        stream.on('error', (err) => {
            logger.error('ytdl-core stream error', { id, error: err.message });
            if (!res.headersSent) res.status(500).send("Streaming failed");
        });

    } catch (error) {
        logger.error('Proxy Stream Error', { error: error.message });
        if (!res.headersSent) res.status(500).send("Proxy failed");
    }
});

module.exports = router;
