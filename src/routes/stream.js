const express = require('express');
const router = express.Router();
const z = require('zod');
const ytdlpService = require('../services/ytdlpService');
const telegramService = require('../services/telegramService');
const songModel = require('../models/songModel');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

// Configurable Cache TTL (10-30 minutes)
const STREAM_CACHE_TTL = parseInt(process.env.STREAM_CACHE_TTL) || 1200; // Default 20 mins

// Validator ensuring ID conforms to video ID or Telegram ID formatting
const streamSchema = z.object({
    id: z.string().min(3, "ID too short").max(100, "ID too long"), // Allow longer and more characters for Telegram
});

router.get('/', async (req, res) => {
    let videoId = 'unknown';
    try {
        // Validate request parameter
        const validated = streamSchema.parse(req.query);
        videoId = validated.id;

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

        let streamUrl;

        // Handle Telegram IDs
        if (videoId.startsWith('tg_')) {
            const song = await songModel.findById(videoId);
            if (!song) {
                return res.status(404).json({ error: 'Telegram song not found' });
            }
            streamUrl = await telegramService.getDirectUrl(song.file_id);
        } else {
            // Extract direct URL using yt-dlp (Service handles retry)
            streamUrl = await ytdlpService.extractAudioStream(videoId);
        }

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
        logger.error('Stream API Error', { videoId, error: error.message });
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

module.exports = router;
