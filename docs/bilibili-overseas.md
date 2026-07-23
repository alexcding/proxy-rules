# Bilibili Overseas Streaming Acceleration — Research Notes

Goal: make the **Bilibili mobile app** (iOS/Surge) start videos as fast as the web player
does for users **outside mainland China**. Web is fast because, from an overseas IP, Bilibili
serves a CDN-only playurl with no P2P. The app, routed through a China proxy, gets a
PCDN/P2P-heavy response and wastes 10–60s trying peers before falling back to CDN.

Module: [`bili_overseas.sgmodule`](../bili_overseas.sgmodule) (+ [`bili_overseas.js`](../bili_overseas.js)).

---

## 1. How Bilibili delivers video on the app (from real Surge captures)

- **playurl API is gRPC/protobuf**, gzip-compressed, on:
  - `grpc.biliapi.net/bilibili.app.playerunite.v1.Player/PlayViewUnite`
  - `app.bilibili.com/…/PlayViewUnite`
  - (also `…app.playurl.v1.PlayURL/PlayView`, `…pgc.gateway.player.v2.PlayURL/PlayView`)
  It is NOT JSON, so the web-userscript trick (rewrite JSON playurl) doesn't directly apply.
- Each stream in the playurl carries **multiple source URLs** for the same segment:
  - PCDN/P2P peers: `http://<ip>:8000/v1/resource/upgcxcode/…?agrr=1&…&os=mcdn&…&e=<upsig>`
  - CDN: `http://upos-sz-mirror*.bilivideo.com/upgcxcode/…?e=<upsig>`
  - Protobuf layout (PlayViewUnite): stream list at `.1.5`/`.1.6`; per-stream
    `base_url` = field 1, `backup_url` = repeated field 2. **base_url is usually a PCDN peer.**
  - **Both PCDN and CDN URLs share the same `e=<upsig>`** — so you can turn a PCDN URL into a
    working CDN URL just by swapping host + stripping the `/v1/resource` prefix.
- **P2P swarm** runs somewhat independently of the playurl URLs:
  - Peer data ports: **4480, 4483, 8000, 8082, 9102** (mostly 8000/4480).
  - Tracker: `hw-edge-v2.solseed.cn` (`bilibili.p2p.b3.tracker.v1.*`).
  - STUN (danmaku/live P2P): `stun.chat.bilibili.com:3478`.
  - HTTP tracker: `api.bilibili.com/x/pd-proxy/tracker`.
  - From overseas, most peers are China-residential IPs that return **0 bytes and hang the
    full ~10s timeout**; occasionally one delivers.

## 2. PCDN/MCDN signatures (what to target)

- Domains: `mcdn.bilivideo.com` / `.cn` / `.net`, `*.szbdyd.com`, `*.mountaintoys.cn`
  (`edge.mountaintoys.cn`), `*.yirujs.com`, `jdcloudcdn.com` (JD Cloud MCDN), regional
  `cn-*.bilivideo.(com|cn)`.
- Raw IP + port media: `http://<ip>:PORT/v1/resource/upgcxcode/…` and `http://<ip>:4480/upgcxcode/…`.
- Path marker: `/v1/resource/` prefix (PCDN) vs bare `/upgcxcode/` (CDN).
- Query marker: `os=mcdn` (fallback for domainless nodes).
- Real CDN hosts: `upos-*.bilivideo.com` (ali/cos/hw + `*ov` overseas variants), akamai
  `upos-*-mirrorakam.akamaized.net`.

## 3. Approaches tried, and what each taught us (chronological)

| Approach | Result | Lesson |
|---|---|---|
| REJECT PCDN domains (`mcdn`, `szbdyd`, …) | No effect | Real infra didn't match; app uses raw-IP peers + `solseed.cn`, not those domains. |
| REJECT `solseed.cn` + raw-IP `/upgcxcode/` (URL-REGEX) | Partial | `URL-REGEX,^http://\d{1,3}...` — **commas in `{1,3}` broke Surge parsing** ("unknown policy"). Use `\d+\.\d+\.\d+\.\d+`, never `{n,m}` in Surge regex rules. |
| Block P2P HTTPDNS `/resolve?host=` | Harmful | `/resolve?host=` is Bilibili **HTTPDNS** (resolves ALL app hosts), not PCDN. Blocking it slows startup. Do NOT block. |
| `DEST-PORT,8000/4480,REJECT` | 41s, worse | Instantly rejecting peers makes the app treat the source as failed → **retries whole playurl with backoff** (0/9/20/40s). |
| Let peers hang (no block) | 35–67s | Same retry-backoff, driven by the 10s peer-hang timeout. |
| **Protobuf playurl rewrite** (`bili_overseas.js`) | Works but fragile | Parses gRPC/gzip PlayViewUnite, replaces every non-`upos` stream URL with the CDN sibling, re-frames uncompressed (flag=0). **Must use pako for inflate** — tiny-inflate threw "Data error" on ~1/3 of real responses → fail-safe passthrough → PCDN leak → retries. Even reliable, it can't stop the app from *trying* peers it discovers. |
| Redirect PCDN media → CDN with **`302`** | Failed | App **ignores 302 for media segments** (treats source as failed → playurl retry storm, still ~42s). Also HTTPS-to-raw-IP PCDN can't be rewritten (no SNI to MITM). |
| Redirect PCDN media → CDN with **`header`** (current, works) | ✅ Good | Same rewrite but **transparent** internal mode: Surge fetches the CDN and hands the app the actual bytes (no redirect to ignore). This is what finally felt fast. `force-http-engine` on PCDN ports + `[URL Rewrite] … header` to `upos-sz-mirrorcosov`, reusing the `e=<upsig>`. |

### Key insight
**Redirect, don't reject.** Every failure mode (reject / hang / leak) makes a media request
*fail*, and the app's response to a failed stream source is to re-request the whole playurl with
exponential backoff — that is the real cause of the 10–60s cold starts. A 302 that lands on a
working CDN URL keeps the app happy.

Secondary: the CDN itself is NOT the bottleneck — once used, `upos-sz-estgoss` delivered ~1 MB in
~1.1s. So "pick the fastest CDN" (TTFB probing, like the web userscript) would not help here.

## 4. Current solution — `bili_overseas.sgmodule`

Three layers in one module:
1. `[General] force-http-engine-hosts = %APPEND% *:4480, *:4483, *:8000, *:8082, *:9102`
   — makes raw-IP:port PCDN media parse as HTTP so it can be rewritten.
2. `[URL Rewrite]` **`header`** (transparent) rewrite:
   `^https?:\/\/(?!upos-)[\w.\-]+(?::\d+)?\/(?:v1\/resource\/)?(upgcxcode\/\S+)$`
   → `https://upos-sz-mirrorcosov.bilivideo.com/$1 header` — reuses the `e=<upsig>` in the PCDN URL.
   MUST be `header` not `302` (the app ignores 302 for media segments).
3. `[Script]` protobuf playurl rewrite (`bili_overseas.js`, pako-based, fail-safe) — cleans the
   playurl so the app's primary source is CDN (fewer peer attempts).
- `[MITM]`: `grpc.biliapi.net, app.bilibili.com, *.mcdn.bilivideo.cn, *.szbdyd.com, *.mountaintoys.cn, *.yirujs.com`.

### Verified
- Redirect regex reconstructs valid CDN URLs from real raw-IP/`yirujs`/`mcdn`/`szbdyd` captures;
  skips `upos-*` (no loop).
- Protobuf rewrite verified across 18 real `response.dump` fixtures: 16 rewritten clean, 2
  already-CDN, 0 PCDN leaks (with pako).

## 5. Surge gotchas learned (important for iteration)

- **Module content is cached on Surge iOS.** Toggling the proxy off/on recompiles from the
  cached copy; it does NOT re-download. Use **Modules → Update** to pull new commits. Verify the
  running version via the `#!FROM-MODULE:<name>` tags in the exported profile.
- **iOS stores modules in the app container**, not in `Default.conf` (no `[Module]` section there).
  Absence of `[Module]` means nothing. Don't edit the user's live `Default.conf`.
- **No `{n,m}` regex quantifiers** in Surge `[Rule]`/`[URL Rewrite]` — the comma breaks CSV parsing
  ("unknown policy"). Use `\d+`, `\d\d?`, etc.
- gRPC per-message compression flag: emitting `flag=0` (uncompressed) is valid even if
  `grpc-encoding: gzip` — lets us avoid a deflate encoder (only need inflate).
- `binary-body-mode` body handoff format (Uint8Array vs base64) is version-dependent; the script
  handles both. `[BILI-CDN] rewrote N` log line confirms the script fired.

## 6. Mobile blocking methods (reference)

- **iOS** (Surge/Loon/Shadowrocket/QuantumultX): force-http-engine on PCDN ports + redirect
  PCDN→CDN. Ready-made: BiliUniverse/Redirect, QingRex/LoonKissSurge "🍟 BiliRedirect".
- **Android**: Clash Meta / FlClash / Surfboard (reject rules; no Surge-style scripting),
  AdGuard for Android (DNS-level domain block, misses raw-IP), rooted LSPosed app hooks (BBLL),
  or router-level (AdGuard Home / Pi-hole) covering the whole LAN.

## 6b. Outcome (2026-07-22) — what actually works

- **Routing beats media-rewriting.** The reliable fix is `bili-direct.conf` (DIRECT for
  `grpc.biliapi.net` + `app.bilibili.com`), referenced **above** `cn-proxy.conf` in `Default.conf`.
  From the overseas IP, Bilibili returns a CDN-only, no-P2P playurl → regular (UGC) videos start
  fast, single playurl call, no retry storm. Media (`bilivideo.com`) already DIRECT via `cn-direct.conf`.
- **The `bili_overseas` module is then largely redundant** for UGC; recommend it OFF (its global
  `force-http-engine` adds overhead / possible stalls, and routing already yields CDN-only playurl).
- **Paid / PGC (番剧, membership) stays slow — proxy can't reliably fix it.** Membership verifies
  fine via China (`api.bilibili.com/pgc/...`), but PGC content insists on P2P peers that hang from
  overseas (~10s each), and PGC playurl shares host/connection with UGC so it can't be routed
  separately. The module's redirect + the app's internal P2P negotiation don't fully solve it.
  Robust answer for paid content: a region-unlock/roaming client (biliRoaming / 哔哩漫游), not proxy rules.
- **Net:** UGC fixed via routing; PGC is an accepted limitation (or use biliRoaming).

## 6c. `bili_cdn_only` module (added 2026-07-22, commit 83779b1)

A smarter playurl rewriter than `bili_overseas.js`, porting realzza/bilibili-accelerator's
`core/rewrite.js` classification. Same protobuf+pako machinery, but the URL policy is:
- PCDN (bare IP / **non-default port** / `os=mcdn` / szbdyd / mountaintoys / nexusedgeio /
  ahdohpiechei / **yirujs** / xy-mcdn / `upos-*302*` / **mirror14b**) → `upos-sz-mirrorcosov`,
  stripping the `/v1/resource` path prefix so the CDN path is valid.
- MCDN (`*.mcdn.bilivideo.*`) → **Bilibili's own relay** `proxy-tf-all-ws.bilivideo.com/?url=…`.
- szbdyd scheduler → the `xy_usource` host embedded in its query.
- Healthy CDN + live (`/live-bvc/`) left alone.
Verified against the real 6:09 playurl body: 18 PCDN/P2P URLs → CDN, healthy mirrors preserved,
0 residual PCDN, valid re-parse. Use INSTEAD of `bili_overseas` (don't run both — they'd double-process
the same PlayView response). Target host `upos-sz-mirrorcosov` is a hardcoded bet; make it an argument
or add TTFB probing if it underperforms in a region.

## 7. Ideas to improve next time

- **Confirm the redirect actually fixes cold start** with a fresh capture; if `force-http-engine`
  mishandles pure-P2P (non-HTTP) handshakes on :8000, revisit.
- **Region-aware target**: choose `upos-sz-mirror{ali,cos,hw}ov` by probing which overseas mirror
  is fastest from the user's location (TTFB), instead of hardcoding `cosov`.
- **Decide whether the protobuf script is still needed** once redirect is confirmed — it may be
  redundant (redirect catches media regardless of playurl), and dropping it removes ~26 KB + the
  binary-body dependency.
- **Root-cause alternative**: route `grpc.biliapi.net` + `app.bilibili.com` PlayView **off the
  China proxy** so Bilibili signs a CDN-only, no-P2P playurl (the true "web experience"). Weigh
  geo/content trade-offs. This needs no rewrite at all if acceptable.
- **Strip PCDN-only query params** (`agrr`, `build`, `os=mcdn`, `mcdnid`) on redirect if any CDN
  mirror rejects the extra params (not observed so far, but a known risk of host-swapping).
- Keep the debug logger (`bilibili_debug.sgmodule`) for measuring playurl→first-media gap.

## Sources
- SukkaW/Make-Bilibili-Great-Than-Ever-Before, issue #26 (PCDN feature rules)
- BiliUniverse/Redirect · QingRex/LoonKissSurge "🍟 BiliRedirect" (Surge/Loon redirect module)
- tonydongguwpi/AdGuard-BiliCDN-Rules (domain blocklist)
- lainbo.dev / itdong.me — "Bilibili Playback Optimization / Disable PCDN"
- linux.do topic 642419 — 关于屏蔽 PCDN 的指引
- guozhigq/pilipala issue #70 — 屏蔽 B 站 p2p 视频分发 CDN
- kokoryh/Sparkle — bilibili.protobuf.response.js (ad/danmaku, does NOT do CDN replacement)
