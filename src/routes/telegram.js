const express = require('express');
const router = express.Router();
const songModel = require('../models/songModel');
const telegramService = require('../services/telegramService');
const logger = require('../utils/logger');

// GET /songs - List all indexed songs
router.get('/songs', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const songs = await songModel.getAll(page, limit);
        res.json({ results: songs });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /search - Search songs by title or artist
router.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.status(400).json({ error: 'Query is required' });
        const results = await songModel.search(query);
        res.json({ results });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /stream?id=<song_id> - Get playable URL
router.get('/stream', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: 'ID is required' });

        const song = await songModel.findById(id);
        if (!song) return res.status(404).json({ error: 'Song not found' });

        const url = await telegramService.getDirectUrl(song.file_id);
        res.json({
            url: url,
            expiresIn: 3600
        });
    } catch (error) {
        logger.error('Telegram Stream Error', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch stream URL' });
    }
});

// GET/POST /sync - Manual trigger for sync
router.all('/sync', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    try {
        const addedCount = await telegramService.syncFromUpdates();
        res.json({ success: true, addedCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /status - Check bot connection
router.get('/status', async (req, res) => {
    try {
        const data = await telegramService._get(`${telegramService.apiUrl}/getMe`);
        logger.info('Bot Status Check', { success: data.ok, bot: data.result?.username });
        res.json({
            success: data.ok,
            bot: data.result ? {
                username: data.result.username,
                can_read_messages: data.result.can_read_group_messages,
                supports_inline: data.result.supports_inline_queries
            } : null,
            channel_id: telegramService.channelId
        });
    } catch (error) {
        logger.error('Bot Status Check Failed', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
