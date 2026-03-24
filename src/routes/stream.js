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
        const cachedStreamUrl = cacheService.get(cacheKey);

        if (cachedStreamUrl) {
            logger.info('Stream cache hit', { videoId });
            return res.json({ stream: cachedStreamUrl });
        }

        // Fetch stream from service wrapper
        const streamUrl = await ytdlpService.extractAudioStream(videoId);

        // Update Cache (TTL = 30 minutes normally fine for long-lasting YouTube stream tokens)
        cacheService.set(cacheKey, streamUrl, 1800);
        logger.info('Stream cache miss, stored in cache', { videoId });

        return res.json({ stream: streamUrl });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
        }

        if (error.message.includes('Stream extraction failed')) {
            return res.status(502).json({ error: 'Failed to extract audio stream from source.' });
        }

        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
