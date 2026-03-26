const ytMusic = require('./src/services/youtubeMusicApi');
const pipedApi = require('./src/services/pipedApi');

async function test() {
    console.log("=== Testing YouTube Music Search ===");
    try {
        const results = await ytMusic.search('Autechre');
        console.log(`Found ${results.length} results.`);
        console.log(results.slice(0, 2));

        if (results.length > 0) {
            const firstId = results[0].videoId;
            console.log(`\n=== Testing Piped API Stream for ${firstId} ===`);
            const stream = await pipedApi.getStream(firstId);
            console.log(`Stream URL: ${stream.url}`);
            console.log(`Stream Size: ${stream.size}`);
        }
    } catch (e) {
        console.error("Test failed:", e);
    }
}

test();
