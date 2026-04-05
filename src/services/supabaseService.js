const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    logger.info('Supabase client initialized');
}

/**
 * Get cached Discord Message ID for a YouTube Video
 */
const getMessageId = async (youtubeId) => {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('discord_cache')
            .select('message_id')
            .eq('youtube_id', youtubeId)
            .single();

        if (error || !data) return null;
        return data.message_id;
    } catch (e) {
        logger.error('Supabase getMessageId failed', e);
        return null; // Graceful fallback if table doesn't exist
    }
};

/**
 * Save new Discord Message ID mapping
 */
const saveMessageId = async (youtubeId, messageId) => {
    if (!supabase) return;
    try {
        const { error } = await supabase
            .from('discord_cache')
            .upsert({ youtube_id: youtubeId, message_id: messageId });

        if (error) {
            logger.error('Supabase saveMessageId failed', error);
        }
    } catch (e) {
        logger.error('Supabase saveMessageId failed', e);
    }
};

module.exports = {
    getMessageId,
    saveMessageId
};
