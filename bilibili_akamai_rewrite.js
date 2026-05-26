function parseArgumentString(argumentText) {
  const parsed = {};
  if (!argumentText) return parsed;

  for (const chunk of argumentText.split("&")) {
    if (!chunk) continue;
    const [rawKey, rawValue = ""] = chunk.split("=");
    const key = decodeURIComponent(rawKey || "").trim();
    if (!key) continue;
    parsed[key] = decodeURIComponent(rawValue || "").trim();
  }

  return parsed;
}

const args = parseArgumentString(typeof $argument === "string" ? $argument : "");
const PREFERRED_HOST = args.preferred_host || "upos-hz-mirrorakam.akamaized.net";

function rewriteToPreferred(urlString) {
  if (!urlString || typeof urlString !== "string") return urlString;
  try {
    const url = new URL(urlString);
    url.protocol = "https:";
    url.host = PREFERRED_HOST;
    return url.toString();
  } catch (error) {
    return urlString;
  }
}

function normalizeFallbacks(originalUrl, fallbackList) {
  const ordered = [];

  if (originalUrl && typeof originalUrl === "string") {
    ordered.push(originalUrl);
  }

  if (Array.isArray(fallbackList)) {
    ordered.push(...fallbackList.filter((item) => typeof item === "string" && item.length > 0));
  }

  const seen = new Set();
  return ordered.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function rewriteDashStream(item) {
  if (!item || typeof item !== "object") return;

  const originalUrl = item.base_url || item.baseUrl;
  if (!originalUrl || typeof originalUrl !== "string") return;

  const rewrittenUrl = rewriteToPreferred(originalUrl);
  const backupList = normalizeFallbacks(originalUrl, item.backup_url || item.backupUrl);

  item.base_url = rewrittenUrl;
  item.baseUrl = rewrittenUrl;

  if (backupList.length > 0) {
    item.backup_url = backupList;
    item.backupUrl = backupList;
  }
}

function rewriteDurlStream(item) {
  if (!item || typeof item !== "object" || typeof item.url !== "string") return;

  const originalUrl = item.url;
  item.url = rewriteToPreferred(originalUrl);

  const backupList = normalizeFallbacks(originalUrl, item.backup_url);
  if (backupList.length > 0) {
    item.backup_url = backupList;
  }
}

function rewritePlayInfo(payload) {
  let videoInfo;

  if (payload && payload.result) {
    videoInfo = payload.result.dash === undefined ? payload.result.video_info : payload.result;
    if (!videoInfo?.dash) {
      if (Array.isArray(payload.result?.durl)) {
        payload.result.durl.forEach(rewriteDurlStream);
      }
      if (Array.isArray(payload.result?.durls)) {
        payload.result.durls.forEach((entry) => {
          if (Array.isArray(entry?.durl)) entry.durl.forEach(rewriteDurlStream);
        });
      }
      return;
    }
  } else {
    videoInfo = payload?.data;
  }

  if (Array.isArray(videoInfo?.dash?.video)) {
    videoInfo.dash.video.forEach(rewriteDashStream);
  }
  if (Array.isArray(videoInfo?.dash?.audio)) {
    videoInfo.dash.audio.forEach(rewriteDashStream);
  }
  if (Array.isArray(videoInfo?.durl)) {
    videoInfo.durl.forEach(rewriteDurlStream);
  }
}

try {
  const body = $response.body;
  if (!body || typeof body !== "string") {
    $done({});
  } else {
    const payload = JSON.parse(body);
    rewritePlayInfo(payload);
    $done({ body: JSON.stringify(payload) });
  }
} catch (error) {
  console.log(`bilibili_akamai_rewrite failed: ${String(error)}`);
  $done({});
}
