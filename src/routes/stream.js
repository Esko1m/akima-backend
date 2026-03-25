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

        logger.info('Proxying stream requested', { id });

        const child = ytdlpService.spawnStream(id);

        // Set correct Content-Type for MP3 streams
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Transfer-Encoding', 'chunked');

        // Pipe stdout to response
        child.stdout.pipe(res);

        // Handle errors and cleanup
        child.on('error', (err) => {
            logger.error('yt-dlp spawn error', { id, error: err.message });
            if (!res.headersSent) res.status(500).send("Extraction error");
        });

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes('ERROR')) logger.error('yt-dlp proxy error', { id, msg });
        });

        child.on('close', (code) => {
            if (code !== 0) logger.warn('yt-dlp proxy closed with code', { id, code });
            res.end();
        });

        req.on('close', () => {
            child.kill('SIGTERM');
        });

    } catch (error) {
        logger.error('Proxy Stream Error', { error: error.message });
        res.status(500).send("Proxy failed");
    }
});

module.exports = router;
