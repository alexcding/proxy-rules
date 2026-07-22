// Bilibili playurl JSON CDN optimizer (Surge/Loon http-response script)
//
// Adapted from the web-only "Bilibili Accelerator" userscript. Runs on the
// mobile app's *JSON* playurl responses only. It cannot touch the newer
// gRPC/protobuf PlayView calls (binary), so the [Rule] REJECT layer in the
// companion .sgmodule remains the primary defense against PCDN/P2P.
//
// What it does to each URL found in the response:
//   1. Rewrites Tencent COS mirror hosts (upos-*-mirrorcos*) to the overseas
//      COSOV mirror. Same backend => the upsig signature stays valid.
//   2. Drops PCDN/P2P entries (mcdn / szbdyd / mountaintoys / nexusedgeio /
//      os=mcdn) from backup_url / backupUrl arrays so the player never tries
//      a peer node.

const TARGET_HOST = "upos-sz-mirrorcosov.bilivideo.com";

// COS-family mirror host on the upgcxcode media path -> safe to swap to COSOV.
const COS_REWRITE_RE =
  /^(https?:\/\/)upos-(?:sz|hz|bstar)-mirrorcos[a-z0-9]*\.bilivideo\.com(\/upgcxcode\/)/i;

// PCDN / P2P backends the app should never use.
const PCDN_RE =
  /(?:\.szbdyd\.com|\.mountaintoys\.cn|\.nexusedgeio\.com|mcdn\.bilivideo\.(?:cn|com|net))/i;
const PCDN_PARAM_RE = /[?&]os=[a-z0-9]*mcdn/i;

// Keys whose string value is a single media URL.
const URL_KEYS = new Set(["url", "base_url", "baseUrl"]);
// Keys whose value is an array of backup media URLs.
const BACKUP_KEYS = new Set(["backup_url", "backupUrl"]);

function isPcdn(u) {
  return typeof u === "string" && (PCDN_RE.test(u) || PCDN_PARAM_RE.test(u));
}

function optimizeUrl(u) {
  if (typeof u !== "string") return u;
  return u.replace(COS_REWRITE_RE, "$1" + TARGET_HOST + "$2");
}

function walk(node) {
  if (node === null || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = walk(node[i]);
    return node;
  }

  for (const key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
    const val = node[key];

    if (URL_KEYS.has(key) && typeof val === "string") {
      node[key] = optimizeUrl(val);
    } else if (BACKUP_KEYS.has(key) && Array.isArray(val)) {
      node[key] = val
        .filter((u) => !isPcdn(u)) // strip peer nodes
        .map(optimizeUrl);
    } else {
      node[key] = walk(val);
    }
  }
  return node;
}

(function main() {
  const body = $response.body;
  if (!body) {
    $done({});
    return;
  }
  try {
    const json = JSON.parse(body);
    walk(json);
    $done({ body: JSON.stringify(json) });
  } catch (e) {
    // Not JSON (e.g. protobuf) or parse failure — pass through untouched.
    $done({});
  }
})();
