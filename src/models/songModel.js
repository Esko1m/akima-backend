const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!supabaseUrl || !supabaseKey) {
    logger.error('Supabase credentials missing in environment variables. Model will operate in disabled mode.');
}

// Only create client if URL is present to prevent top-level crash
const supabase = supabaseUrl ? createClient(supabaseUrl, supabaseKey || '') : null;

class SongModel {
    constructor() {
        this.tableName = 'songs';
        this.supabase = supabase;
        this.disabled = !supabase;
    }

    async getAll(page = 1, limit = 20) {
        if (this.disabled) return [];
        try {
            const start = (page - 1) * limit;
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .range(start, start + limit - 1)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (error) {
            logger.error('Supabase getAll error', { error: error.message });
            return [];
        }
    }

    async search(query) {
        if (this.disabled) return [];
        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .or(`title.ilike.%${query}%,artist.ilike.%${query}%`)
                .limit(20);

            if (error) throw error;
            return data || [];
        } catch (error) {
            logger.error('Supabase search error', { error: error.message });
            return [];
        }
    }

    async findById(id) {
        if (this.disabled) return null;
        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .select('*')
                .eq('id', id)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Supabase findById error', { id, error: error.message });
            return null;
        }
    }

    async add(song) {
        if (this.disabled) return false;
        try {
            const { data, error } = await supabase
                .from(this.tableName)
                .upsert([song], { onConflict: 'message_id' });

            if (error) throw error;
            return true;
        } catch (error) {
            logger.error('Supabase add error', { error: error.message });
            return false;
        }
    }

    async updateSongs(newSongs) {
        if (this.disabled) return 0;
        try {
            if (newSongs.length === 0) return 0;

            // Upsert all songs at once for efficiency
            const { data, error } = await supabase
                .from(this.tableName)
                .upsert(newSongs, { onConflict: 'message_id' });

            if (error) throw error;
            return newSongs.length;
        } catch (error) {
            logger.error('Supabase updateSongs error', { error: error.message });
            return 0;
        }
    }
}

module.exports = new SongModel();
