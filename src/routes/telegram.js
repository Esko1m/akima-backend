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

// GET /status - Check bot and database connection
router.get('/status', async (req, res) => {
    try {
        // 1. Check Telegram
        const tgData = await telegramService._get(`${telegramService.apiUrl}/getMe`);

        // 2. Check Supabase
        let sbStatus = 'disconnected';
        let songCount = 0;
        if (!songModel.disabled) {
            const { count, error } = await songModel.supabase
                .from(songModel.tableName)
                .select('*', { count: 'exact', head: true });
            if (!error) {
                sbStatus = 'connected';
                songCount = count || 0;
            } else {
                sbStatus = `error: ${error.message}`;
            }
        }

        logger.info('Status Check', {
            tg_ok: tgData.ok,
            sb_status: sbStatus,
            songs_in_db: songCount
        });

        res.json({
            success: tgData.ok && sbStatus === 'connected',
            telegram: {
                active: tgData.ok,
                bot: tgData.result?.username
            },
            supabase: {
                status: sbStatus,
                total_songs: songCount
            },
            env: {
                has_bot_token: !!process.env.TELEGRAM_BOT_TOKEN,
                has_channel_id: !!process.env.TELEGRAM_CHANNEL_ID,
                has_supabase_url: !!process.env.SUPABASE_URL || !!process.env.NEXT_PUBLIC_SUPABASE_URL,
                has_supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY || !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
            }
        });
    } catch (error) {
        logger.error('Status Check Failed', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
