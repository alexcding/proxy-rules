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

function replaceHostPreservingEscapeStyle(input, stats) {
  if (!input || typeof input !== "string") return input;

  const escapedPattern = /("(?:base_url|baseUrl|url|readyVideoUrl)"\s*:\s*")https:\\\/\\\/[^/"]+\\\//g;
  const plainPattern = /("(?:base_url|baseUrl|url|readyVideoUrl)"\s*:\s*")https:\/\/[^/"]+\//g;

  let output = input.replace(escapedPattern, (m, p1) => {
    stats.escaped += 1;
    return `${p1}https:\\/\\/${PREFERRED_HOST}\\/`;
  });

  output = output.replace(plainPattern, (m, p1) => {
    stats.plain += 1;
    return `${p1}https://${PREFERRED_HOST}/`;
  });

  return output;
}

function detectPlayInfo(body) {
  const markers = ["__playinfo__", "window.__playinfo__", "playurl-html5", "playurlSSRData", "dash\":{", "\"durl\":[", "\"base_url\":", "\"baseUrl\":"];
  const found = [];
  for (const m of markers) {
    if (body.indexOf(m) >= 0) found.push(m);
  }
  return found.join("|");
}

console.log(`[bilibili-akamai-page] invoked url=${$request && $request.url} preferred=${PREFERRED_HOST}`);
try {
  const body = $response.body;
  const headers = Object.assign({}, $response.headers || {});
  if (!body || typeof body !== "string") {
    headers["X-Akamai-Rewrite"] = "skip-empty-body";
    console.log(`[bilibili-akamai-page] empty body, skipping`);
    $done({ headers });
  } else {
    const stats = { escaped: 0, plain: 0 };
    const markers = detectPlayInfo(body);
    const rewritten = replaceHostPreservingEscapeStyle(body, stats);
    const containsAkamai = rewritten.indexOf(PREFERRED_HOST) >= 0;
    headers["X-Akamai-Rewrite"] = `bytes=${rewritten.length};escaped=${stats.escaped};plain=${stats.plain};akamai=${containsAkamai};markers=${markers || "none"}`;
    console.log(`[bilibili-akamai-page] ${headers["X-Akamai-Rewrite"]}`);
    $done({ body: rewritten, headers });
  }
} catch (error) {
  console.log(`[bilibili-akamai-page] failed: ${String(error)}`);
  $done({ headers: Object.assign({}, $response.headers || {}, { "X-Akamai-Rewrite": `error:${String(error)}` }) });
}
