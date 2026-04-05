const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const ytdl = require('@distube/ytdl-core');

class YtDlpService {
    constructor() {
        this.ytdlpPath = path.join(process.cwd(), 'yt-dlp.exe');
        this.cookiesPath = path.join(process.cwd(), 'yt-cookies.txt');

        // Ensure yt-dlp binary exists
        if (!fs.existsSync(this.ytdlpPath)) {
            logger.error('CRITICAL: yt-dlp.exe not found in backend root!', { path: this.ytdlpPath });
        }
    }

    /**
     * Extracts best audio stream URL using the local yt-dlp binary.
     * This is highly robust on local Windows machines.
     */
    async extractAudioStream(videoId) {
        logger.info('Executing local binary extraction', { videoId });

        return new Promise((resolve, reject) => {
            const cookiesArg = fs.existsSync(this.cookiesPath) ? `--cookies "${this.cookiesPath}"` : '';

            // Format BestAudio selection logic: Prefer m4a for iOS but accept anything that works.
            const command = `"${this.ytdlpPath}" ${cookiesArg} -f "bestaudio[ext=m4a]/bestaudio" --get-url --no-check-certificates --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "https://www.youtube.com/watch?v=${videoId}"`;

            exec(command, async (error, stdout, stderr) => {
                if (error) {
                    logger.warn('yt-dlp binary failed, falling back to JS library', { videoId, error: stderr || error.message });

                    // Final fallback: JS Library (@distube/ytdl-core)
                    try {
                        const streamUrl = await this.extractWithJs(videoId);
                        resolve(streamUrl);
                    } catch (jsError) {
                        reject(new Error(`Both binary and JS extraction failed: ${jsError.message}`));
                    }
                    return;
                }

                const streamLines = stdout.trim().split('\n');
                const streamUrl = streamLines[0]; // First line is the URL

                if (streamUrl && streamUrl.startsWith('http')) {
                    logger.info('Local binary extraction succeeded', { videoId });
                    resolve(streamUrl);
                } else {
                    reject(new Error('Binary returned invalid URL'));
                }
            });
        });
    }

    /**
     * Fallback extraction using pure JS @distube/ytdl-core.
     */
    async extractWithJs(videoId) {
        logger.info('Executing JS extraction fallback', { videoId });

        try {
            const agent = fs.existsSync(this.cookiesPath) ? ytdl.createAgent(JSON.parse(fs.readFileSync(this.cookiesPath, 'utf8'))) : null;
            const info = await ytdl.getInfo(videoId, { agent });
            const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });

            if (format && format.url) {
                logger.info('JS extraction succeeded', { videoId });
                return format.url;
            }
            throw new Error('No audio format found in JS extraction');
        } catch (error) {
            logger.error('JS extraction final failure', { videoId, error: error.message });
            throw error;
        }
    }
}

module.exports = new YtDlpService();
