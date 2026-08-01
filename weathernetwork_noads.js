// The Weather Network — collapse the anchored banner blank area (no MitM of ads themselves).
//
// The app fetches its ENTIRE runtime config from
//   https://appframework.pelmorex.com/api/appframework/Config/getConfig/iPhone
// The bundled config.json is just the seed/fallback for that response. Inside it,
// Ads.anchoredBannerAd is the app's OWN per-screen switch: "draw an anchored banner
// on this screen?". The shipped config has `news = false`, and the news screen has no
// banner box — proof that when this flag is false the app never lays out the container.
//
// We flip every entry to false so the app skips the banner container on all screens →
// no reserved blank strip. This uses the app's own layout path; it does NOT read, set,
// or spoof any subscription/Account/isPremium state.

let body = $response.body;

try {
  const cfg = JSON.parse(body);
  const list = cfg && cfg.Ads && cfg.Ads.anchoredBannerAd;
  let changed = 0;

  if (Array.isArray(list)) {
    for (const item of list) {
      if (item && item.value !== false) {
        item.value = false;
        changed++;
      }
    }
  }

  if (changed > 0) {
    body = JSON.stringify(cfg);
    // Body was decompressed for the script; drop stale encoding/length so the
    // client doesn't try to gunzip plaintext. Surge recomputes Content-Length.
    const headers = $response.headers || {};
    for (const k of Object.keys(headers)) {
      const lk = k.toLowerCase();
      if (lk === "content-encoding" || lk === "content-length") delete headers[k];
    }
    console.log(`[TWN] anchoredBannerAd disabled on ${changed} screen(s)`);
    $done({ body, headers });
  } else {
    // No matching config in this response (e.g. a non-config payload) — pass through.
    $done({});
  }
} catch (e) {
  console.log(`[TWN] config rewrite skipped (not JSON / parse error): ${e}`);
  $done({});
}
