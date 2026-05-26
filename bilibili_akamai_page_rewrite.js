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

try {
  const body = $response.body;
  if (!body || typeof body !== "string") {
    $done({});
  } else {
    $done({ body: replaceHostPreservingEscapeStyle(body) });
  }
} catch (error) {
  console.log(`bilibili_akamai_page_rewrite failed: ${String(error)}`);
  $done({});
}
