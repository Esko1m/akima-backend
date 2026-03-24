const express = require('express');
const router = express.Router();
const z = require('zod');
const ytdlpService = require('../services/ytdlpService');
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

        // Attempt operation via YT-DLP
        const limit = 10;
        const results = await ytdlpService.searchVideos(query, limit);

        // Save strictly to cache avoiding repeat queries
        // Extended TTL (e.g., 2 hours for search results since titles/ids don't change often)
        cacheService.set(cacheKey, results, 7200);
        logger.info('Search cache miss, stored in cache', { query });

        return res.json(results);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
        }

        // Check if error is specifically from yt-dlp service
        if (error.message.includes('Search failed to execute')) {
            return res.status(502).json({ error: 'Failed to fetch search results from source.' });
        }

        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
