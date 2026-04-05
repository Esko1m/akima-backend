const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');

const YTDLP_PATH = path.join(__dirname, 'yt-dlp.exe');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const fetchYtDlpUrl = (videoId) => {
    return new Promise((resolve, reject) => {
        const args = [
            '--no-check-certificates',
            '--extractor-args', 'youtube:skip=dash',
            '-f', 'bestaudio[ext=m4a]/bestaudio',
            '--user-agent', UA,
            '--get-url',
            `https://www.youtube.com/watch?v=${videoId}`
        ];
        console.log('Spawning yt-dlp...');
        const ytdlp = spawn(YTDLP_PATH, args);
        let streamUrl = '';
        ytdlp.stdout.on('data', (d) => streamUrl += d.toString());
        ytdlp.stderr.on('data', (d) => console.log('yt-dlp err:', d.toString()));
        ytdlp.on('close', (code) => {
            if (code === 0 && streamUrl.trim()) resolve(streamUrl.trim());
            else reject(new Error('Extraction failed'));
        });
    });
};

const downloadToBuffer = (url) => {
    return new Promise((resolve, reject) => {
        console.log('Starting HTTP GET to:', url.substring(0, 50) + '...');
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': UA } }, (res) => {
            console.log('HTTP Status:', res.statusCode);
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log('Redirecting to:', res.headers.location.substring(0, 50) + '...');
                return downloadToBuffer(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode >= 400) {
                return reject(new Error(`Failed to download stream: HTTP ${res.statusCode}`));
            }
            const chunks = [];
            let downloaded = 0;
            res.on('data', d => {
                chunks.push(d);
                downloaded += d.length;
                process.stdout.write(`\rDownloaded: ${(downloaded / 1024 / 1024).toFixed(2)} MB`);
            });
            res.on('end', () => {
                console.log('\nDownload complete.');
                resolve(Buffer.concat(chunks));
            });
            res.on('error', reject);
        }).on('error', reject);
    });
};

async function test() {
    try {
        const url = await fetchYtDlpUrl('dQw4w9WgXcQ');
        console.log('Extracted URL:', url.substring(0, 100) + '...');
        await downloadToBuffer(url);
    } catch (e) {
        console.error('Test Failed:', e);
    }
}
test();
