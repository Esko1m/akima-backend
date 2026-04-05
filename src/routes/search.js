const express = require('express');
const router = express.Router();
const z = require('zod');
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

        // Fetch from YouTube (using yt-search - the "own" way)
        const yts = require('yt-search');
        let ytResults = [];
        try {
            const r = await yts(query);
            ytResults = r.videos.slice(0, 20).map(v => ({
                title: v.title,
                artist: v.author.name,
                videoId: v.videoId,
                thumbnail: v.image,
                duration: v.duration.seconds,
                source: 'youtube'
            }));
        } catch (e) {
            logger.warn('YouTube search (yt-search) failed', { error: e.message });
        }

        const combinedResults = [...ytResults];

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
