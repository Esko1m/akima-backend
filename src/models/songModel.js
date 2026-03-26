const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = path.resolve(__dirname, '../../data/songs.json');

class SongModel {
    constructor() {
        this.songs = [];
        this.load();
    }

    load() {
        try {
            if (!fs.existsSync(path.dirname(DB_PATH))) {
                fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
            }
            if (fs.existsSync(DB_PATH)) {
                const data = fs.readFileSync(DB_PATH, 'utf8');
                this.songs = JSON.parse(data);
            }
        } catch (error) {
            logger.error('Failed to load songs from DB', { error: error.message });
            this.songs = [];
        }
    }

    save() {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify(this.songs, null, 2), 'utf8');
        } catch (error) {
            logger.error('Failed to save songs to DB', { error: error.message });
        }
    }

    getAll(page = 1, limit = 20) {
        const start = (page - 1) * limit;
        return this.songs.slice(start, start + limit);
    }

    search(query) {
        const q = query.toLowerCase();
        return this.songs.filter(s =>
            s.title.toLowerCase().includes(q) ||
            s.artist.toLowerCase().includes(q)
        );
    }

    findById(id) {
        return this.songs.find(s => s.id === id);
    }

    add(song) {
        if (!this.songs.find(s => s.message_id === song.message_id)) {
            this.songs.push(song);
            this.save();
            return true;
        }
        return false;
    }

    updateSongs(newSongs) {
        let addedCount = 0;
        newSongs.forEach(song => {
            if (this.add(song)) addedCount++;
        });
        return addedCount;
    }
}

module.exports = new SongModel();
