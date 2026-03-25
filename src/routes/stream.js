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

        logger.info('Proxying stream requested (range-aware)', { id });

        const streamInfo = await ytdlpService.getStreamInfo(id);
        const { url: youtubeUrl, size: totalSize } = streamInfo;

        const headers = {
            'User-Agent': req.get('User-Agent') || 'Mozilla/5.0'
        };

        if (req.headers.range) {
            headers['Range'] = req.headers.range;
            logger.info('Forwarding range request', { id, range: req.headers.range });
        }

        // Use native fetch (Node 20) to relay the request
        const response = await fetch(youtubeUrl, { headers });

        // Forward status and headers from YouTube
        res.status(response.status);

        // Essential headers for iOS
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', 'audio/mp4');

        if (response.headers.get('content-range')) {
            res.setHeader('Content-Range', response.headers.get('content-range'));
        }
        if (response.headers.get('content-length')) {
            res.setHeader('Content-Length', response.headers.get('content-length'));
        }

        // Pipe the body
        const reader = response.body.getReader();
        const pump = async () => {
            const { done, value } = await reader.read();
            if (done) {
                res.end();
                return;
            }
            res.write(value);
            return pump();
        };

        pump().catch(err => {
            logger.error('Stream pump error', { id, error: err.message });
            res.end();
        });

    } catch (error) {
        logger.error('Proxy Stream Error', { error: error.message });
        if (!res.headersSent) res.status(500).send("Proxy failed");
    }
});

module.exports = router;
