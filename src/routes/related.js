const express = require('express');
const router = express.Router();
const ytdl = require('@distube/ytdl-core');
const z = require('zod');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

// Input validation schema
const querySchema = z.object({
    id: z.string().min(1, "Video ID is required").max(50, "Invalid Video ID"),
});

router.get('/', async (req, res) => {
    try {
        // Validate request
        const validated = querySchema.parse(req.query);
        const { id } = validated;

        // Check caching
        const cacheKey = `related:${id}`;
        const cachedResults = cacheService.get(cacheKey);

        if (cachedResults) {
            logger.info('Related videos cache hit', { id });
            return res.json(cachedResults);
        }

        // Fetch using ytdl-core
        const info = await ytdl.getBasicInfo(id);

        let relatedVideos = info.related_videos || [];
        let combinedResults = [];

        if (relatedVideos.length > 0) {
            combinedResults = relatedVideos.slice(0, 15).map(v => ({
                title: v.title,
                artist: typeof v.author === 'string' ? v.author : (v.author?.name || 'Unknown Artist'),
                videoId: v.id,
                thumbnail: v.thumbnails && v.thumbnails.length > 0 ? v.thumbnails[0].url : '',
                duration: v.length_seconds ? parseInt(v.length_seconds) : 0,
                source: 'youtube'
            }));
        } else {
            const yts = require('yt-search');
            const authorName = info.videoDetails?.author?.name || '';
            const titleWord = info.videoDetails?.title?.split(' ')[0] || '';
            const searchStr = `${authorName} ${titleWord} song`.trim();

            const r = await yts(searchStr || 'music');
            combinedResults = r.videos.filter(v => v.videoId !== id).slice(0, 15).map(v => ({
                title: v.title,
                artist: v.author.name,
                videoId: v.videoId,
                thumbnail: v.image,
                duration: v.duration.seconds,
                source: 'youtube'
            }));
        }

        // Cache the results (2 hours)
        cacheService.set(cacheKey, combinedResults, 7200);
        logger.info('Related videos cache miss, stored in cache', { id, count: combinedResults.length });

        return res.json(combinedResults);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
        }

        logger.error('Related API Error', { error: error.message });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
