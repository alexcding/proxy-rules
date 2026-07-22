// Bilibili diagnostic logger (Surge script) — pass-through, never modifies traffic.
// Writes timestamped lines to the Surge log so you can measure video-start latency:
// find the PLAYURL-RESP line, then the first CDN-MEDIA / PCDN-IP line — the gap between
// their timestamps is the "time to first media byte" after playurl resolves.
//
// Wired by bilibili_debug.sgmodule as two entries (one http-request, one http-response),
// both pointing at this same file; the branch below picks the right behavior.

function stamp() {
  const d = new Date();
  const p = (n, w) => String(n).padStart(w, "0");
  return (
    p(d.getHours(), 2) + ":" + p(d.getMinutes(), 2) + ":" +
    p(d.getSeconds(), 2) + "." + p(d.getMilliseconds(), 3)
  );
}

if (typeof $response !== "undefined" && $response) {
  // http-response context: the gRPC playurl reply just arrived.
  console.log(`[BILI] ${stamp()} PLAYURL-RESP status=${$response.status}`);
  $done({});
} else {
  // http-request context: a media / tracker request is going out.
  const url = $request.url || "";
  const method = $request.method || "GET";
  const isIP = /^https?:\/\/\d{1,3}(\.\d{1,3}){3}/.test(url);
  let tag = "REQ";
  if (/\/upgcxcode\//.test(url)) tag = isIP ? "PCDN-IP" : "CDN-MEDIA";
  else if (/solseed\.cn/.test(url)) tag = "TRACKER";
  else if (isIP && /\/resolve\?host=/.test(url)) tag = "HTTPDNS";
  console.log(`[BILI] ${stamp()} ${tag} ${method} ${url.slice(0, 130)}`);
  $done({});
}
