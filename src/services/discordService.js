const logger = require('../utils/logger');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

/**
 * Gets a fresh, signed 24-hour Discord CDN URL for a cached message
 */
const getCachedStreamUrl = async (messageId) => {
    if (!TOKEN || !CHANNEL_ID || !messageId) return null;

    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${messageId}`, {
            headers: {
                'Authorization': `Bot ${TOKEN}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.attachments && data.attachments.length > 0) {
                logger.info('Retrieved fresh signed URL from Discord REST API 🎉', { messageId });
                return data.attachments[0].url;
            }
        }
    } catch (error) {
        logger.error('Failed to fetch Discord message via REST', error);
    }
    return null;
};

/**
 * Uploads an audio buffer to Discord via REST API and returns the URL and Message ID
 */
const uploadStreamToDiscord = async (youtubeId, title, buffer) => {
    if (!TOKEN || !CHANNEL_ID) throw new Error('Discord credentials missing');

    logger.info('Uploading audio buffer to Discord via REST...', { youtubeId, size: buffer.length });

    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);

    const formData = new FormData();
    formData.append('content', `**Akima Vercel Upload**\nID: \`${youtubeId}\`\nTitle: ${safeTitle}`);

    const fileBlob = new Blob([buffer], { type: 'audio/mpeg' });
    formData.append('files[0]', fileBlob, `${safeTitle}.mp3`);

    const response = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${TOKEN}`
            // Note: FormData automatically sets the Content-Type with the correct boundary in native fetch
        },
        body: formData
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Discord REST upload failed: ${response.status} ${errText}`);
    }

    const data = await response.json();
    logger.info('Successfully uploaded audio to Discord REST API', { youtubeId, messageId: data.id });

    return {
        url: data.attachments[0].url,
        messageId: data.id
    };
};

module.exports = {
    getCachedStreamUrl,
    uploadStreamToDiscord
};
