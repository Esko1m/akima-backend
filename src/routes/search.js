const express = require('express');
const router = express.Router();
const z = require('zod');
const songModel = require('../models/songModel');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

// Input validation schema
const searchSchema = z.object({
    q: z.string().min(1, "Search query is required").max(120, "Query is too long"),
});

router.get('/', async (req, res) => {
    try {
        // Validate request
        const validated = searchSchema.parse(req.query);
        const query = validated.q;

        // Check caching
        const cacheKey = `search:${query.toLowerCase()}`;
        const cachedResults = cacheService.get(cacheKey);

        if (cachedResults) {
            logger.info('Search cache hit', { query });
            return res.json(cachedResults);
        }

        // First search Telegram library (fast local metadata)
        const tgResults = await songModel.search(query);
        const mappedTgResults = tgResults.map(s => ({
            title: s.title,
            artist: s.artist,
            videoId: s.id, // e.g., "tg_123"
            thumbnail: s.thumbnail,
            duration: s.duration,
            source: 'telegram'
        }));

        // Fetch from YouTube Music
        const ytMusicApi = require('../services/youtubeMusicApi');
        let ytResults = [];
        try {
            ytResults = await ytMusicApi.search(query);
            ytResults = ytResults.map(r => ({
                ...r,
                source: 'youtube_music'
            }));
        } catch (e) {
            logger.warn('YouTube search API failed', { error: e.message });
        }

        const combinedResults = [...mappedTgResults, ...ytResults];

        // Cache the results (2 hours)
        cacheService.set(cacheKey, combinedResults, 7200);
        logger.info('Search cache miss, stored in cache', { query, count: combinedResults.length });

        return res.json(combinedResults);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
        }

        logger.error('Search API Error', { error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
