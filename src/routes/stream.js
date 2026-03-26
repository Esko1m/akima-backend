const express = require('express');
const router = express.Router();
const z = require('zod');
const ytdlpService = require('../services/ytdlpService');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

// Configurable Cache TTL (10-30 minutes)
const STREAM_CACHE_TTL = parseInt(process.env.STREAM_CACHE_TTL) || 1200; // Default 20 mins

// Validator ensuring ID conforms roughly to video ID formatting limits
const streamSchema = z.object({
    videoId: z.string().min(5, "Video ID too short").max(20, "Video ID too long").regex(/^[a-zA-Z0-9_-]+$/, "Invalid Video ID format"),
});

router.get('/', async (req, res) => {
    try {
        // Validate request parameter
        const validated = streamSchema.parse(req.query);
        const videoId = validated.videoId;

        // Check Cache
        const cacheKey = `stream:${videoId}`;
        const cachedUrl = cacheService.get(cacheKey);

        if (cachedUrl) {
            logger.info('Stream cache hit', { videoId });
            return res.json({
                url: cachedUrl,
                expiresIn: STREAM_CACHE_TTL
            });
        }

        logger.info('Stream cache miss, extracting...', { videoId });

        // Extract direct URL using yt-dlp (Service handles retry)
        const streamUrl = await ytdlpService.extractAudioStream(videoId);

        // Cache the result
        cacheService.set(cacheKey, streamUrl, STREAM_CACHE_TTL);

        return res.json({
            url: streamUrl,
            expiresIn: STREAM_CACHE_TTL
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
        }
        logger.error('Stream API Error', { videoId: req.query.videoId, error: error.message });
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

module.exports = router;
