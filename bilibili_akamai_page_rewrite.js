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

function record(diag) {
  try {
    if (typeof $persistentStore !== "undefined") {
      $persistentStore.write(JSON.stringify(diag), "bilibili_akamai_page_diag");
    }
  } catch (e) {}
}

const reqUrl = ($request && $request.url) || "";
try {
  const body = $response.body;
  if (!body || typeof body !== "string") {
    record({ at: Date.now(), url: reqUrl, status: "skip-empty-body" });
    $done({});
  } else {
    const stats = { escaped: 0, plain: 0 };
    const markers = detectPlayInfo(body);
    const sampleMatches = [];
    const sampleRe = /"(?:base_url|baseUrl|url|readyVideoUrl)"\s*:\s*"https?:[^"]{0,200}/g;
    let m;
    while ((m = sampleRe.exec(body)) && sampleMatches.length < 5) {
      sampleMatches.push(m[0].slice(0, 200));
    }
    const rewritten = replaceHostPreservingEscapeStyle(body, stats);
    record({
      at: Date.now(),
      url: reqUrl,
      bodyLen: body.length,
      outLen: rewritten.length,
      escaped: stats.escaped,
      plain: stats.plain,
      akamai: rewritten.indexOf(PREFERRED_HOST) >= 0,
      markers: markers || "none",
      sampleMatches
    });
    $done({ body: rewritten });
  }
} catch (error) {
  record({ at: Date.now(), url: reqUrl, error: String(error) });
  $done({});
}
