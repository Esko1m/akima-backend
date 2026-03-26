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

        // Search via Telegram song model
        const results = await songModel.search(query);

        // Map to format frontend expects
        const mappedResults = results.map(s => ({
            title: s.title,
            artist: s.artist,
            videoId: s.id, // e.g., "tg_123"
            thumbnail: s.thumbnail,
            duration: s.duration
        }));

        // Cache the results (2 hours)
        cacheService.set(cacheKey, mappedResults, 7200);
        logger.info('Search cache miss, stored in cache', { query, count: mappedResults.length });

        return res.json(mappedResults);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
        }

        logger.error('Search API Error', { error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
