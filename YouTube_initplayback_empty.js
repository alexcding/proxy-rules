// Surge HTTP Request Script
// Answers YouTube initplayback (Onesie) requests with an empty response so the app
// falls back to youtubei/v1/player, which YouTube_remove_ads_response.js cleans.
// Mirrors the upstream request script's fallback path without its Worker redirect.

const headers = $request.headers;
const userAgent = headers['User-Agent'] || headers['user-agent'] || '';
const platformKey = userAgent.includes('music') ? 'youtubeMusic' : 'youtube';

// Like upstream, drop the cached Onesie key so log_event treats it as absent.
let config = {};
try {
    config = JSON.parse($persistentStore.read('YouTubeConfig') || '{}') || {};
} catch (e) {
    config = {};
}
if (config[platformKey]) {
    delete config[platformKey];
    $persistentStore.write(JSON.stringify(config), 'YouTubeConfig');
}

$done({
    response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: new Uint8Array(),
    },
});
