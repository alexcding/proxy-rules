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

function replaceHostPreservingEscapeStyle(input) {
  if (!input || typeof input !== "string") return input;

  const escapedPattern = /("(?:base_url|baseUrl|url|readyVideoUrl)"\s*:\s*")https:\\\/\\\/[^/"]+\\\//g;
  const plainPattern = /("(?:base_url|baseUrl|url|readyVideoUrl)"\s*:\s*")https:\/\/[^/"]+\//g;

  let output = input.replace(
    escapedPattern,
    `$1https:\\/\\/${PREFERRED_HOST}\\/`
  );

  output = output.replace(
    plainPattern,
    `$1https://${PREFERRED_HOST}/`
  );

  return output;
}

console.log(`[bilibili-akamai-page] invoked url=${$request && $request.url} preferred=${PREFERRED_HOST}`);
try {
  const body = $response.body;
  if (!body || typeof body !== "string") {
    console.log(`[bilibili-akamai-page] empty body, skipping`);
    $done({});
  } else {
    const rewritten = replaceHostPreservingEscapeStyle(body);
    console.log(`[bilibili-akamai-page] rewrote bytes=${rewritten.length} contains_akamai=${rewritten.indexOf(PREFERRED_HOST) >= 0}`);
    $done({ body: rewritten });
  }
} catch (error) {
  console.log(`[bilibili-akamai-page] failed: ${String(error)}`);
  $done({});
}
