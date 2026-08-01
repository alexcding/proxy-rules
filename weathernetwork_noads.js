// The Weather Network — collapse the anchored-banner blank strip.
//
// The app fetches its whole runtime config from
//   https://appframework.pelmorex.com/api/appframework/Config/getConfig/iPhone
// (only every Config.refreshSec = 86400s / 24h — so it runs off a local cache most of
// the time; a fresh fetch happens after reinstall or once the 24h window elapses).
//
// Ads.anchoredBannerAd is the app's OWN per-screen "draw an anchored banner here?" switch
// (shipped config has news=false). Flip every entry to false so the app never lays out the
// banner container → no reserved blank strip. Verified from a traffic capture that the app
// does NOT collapse the box on ad-load failure, so this layout-suppression path is the only
// proxy-level fix. No subscription/Account/isPremium/RevenueCat state is read or modified.

let body = $response.body;

// Turn any anchoredBannerAd structure "off". Handles both shapes:
//   [ {name, value:bool}, ... ]   (bundled schema)
//   { screen: bool, ... }         (defensive alternative)
function disableList(v) {
  let n = 0;
  if (Array.isArray(v)) {
    for (const item of v) {
      if (item && typeof item === "object" && "value" in item && item.value !== false) {
        item.value = false; n++;
      }
    }
  } else if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (v[k] !== false) { v[k] = false; n++; }
    }
  }
  return n;
}

// Recursively find every key literally named "anchoredBannerAd" and disable it, so a
// differently-nested remote schema is still caught.
function walk(o) {
  let n = 0;
  if (Array.isArray(o)) {
    for (const x of o) n += walk(x);
  } else if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      if (k === "anchoredBannerAd") n += disableList(o[k]);
      else n += walk(o[k]);
    }
  }
  return n;
}

try {
  const cfg = JSON.parse(body);
  // Diagnostic: prove the rewrite saw the real config and show its shape once.
  if (cfg && typeof cfg === "object") {
    console.log(`[TWN] getConfig intercepted; top keys: ${Object.keys(cfg).join(",")}`);
  }
  const changed = walk(cfg);

  if (changed > 0) {
    body = JSON.stringify(cfg);
    const headers = $response.headers || {};
    for (const k of Object.keys(headers)) {
      const lk = k.toLowerCase();
      if (lk === "content-encoding" || lk === "content-length") delete headers[k];
    }
    console.log(`[TWN] anchoredBannerAd disabled on ${changed} screen(s)`);
    $done({ body, headers });
  } else {
    console.log(`[TWN] no anchoredBannerAd found in this response — passing through`);
    $done({});
  }
} catch (e) {
  console.log(`[TWN] config rewrite skipped (not JSON / parse error): ${e}`);
  $done({});
}
