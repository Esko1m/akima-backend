const express = require('express');
const router = express.Router();
const z = require('zod');
const logger = require('../utils/logger');

// Validator
const streamSchema = z.object({
    id: z.string().min(3, "ID too short"),
});

router.get('/', async (req, res) => {
    let videoId = 'unknown';
    try {
        const validated = streamSchema.parse(req.query);
        videoId = validated.id;

        // For EVERYTHING (YouTube), return the proxy URL.
        const protocol = req.protocol;
        const host = req.get('host');
        const proxyUrl = `${protocol}://${host}/proxy?id=${videoId}`;

        logger.info('Unified Streaming: Returning local proxy URL', { videoId, proxyUrl });

        return res.json({ url: proxyUrl });

    } catch (error) {
        logger.error('Streaming route error', { videoId, error: error.message });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
