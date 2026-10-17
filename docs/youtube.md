# YouTube Surge module

[`youtube.sgmodule`](../youtube.sgmodule) ports all three script rules and the
hostname list from [efzb-wx/loon commit 91e0f4c2](https://github.com/efzb-wx/loon/commit/91e0f4c2b3ada0be94c93d1c5e040af7deee96bd).
The [original Loon plugin](../vendor/efzb-wx/loon/YoutubeBlock/YouTube_remove_ads.lpx)
is preserved unchanged. Both referenced JavaScript bundles are copied into this
repository with their original author headers and bytes intact:

| File | Upstream URL | Build stamp | SHA-256 |
| --- | --- | --- | --- |
| `YouTube_remove_ads_request.js` | [request source](https://kelee.one/Resource/JavaScript/YouTube/YouTube_remove_ads/YouTube_remove_ads_request.js) | 2026/7/12 22:44:32 | `af0646890f9847aa4576181b0637e31b86a3e2f6dd4d2041a56ffa971aacc10b` |
| `YouTube_remove_ads_response.js` | [response source](https://kelee.one/Resource/JavaScript/YouTube/YouTube_remove_ads/YouTube_remove_ads_response.js) | 2026/7/19 16:16:39 | `b926d339069a8f54e84bd5d29e8c8364ee9ea72bb170197e281b04eda49e3568` |

Downloaded on 2026-09-12. The commit pins the plugin only; its script URLs are
mutable, so these bundles are the versions served on the download date, not
verified historical script versions. The server requires a Loon User-Agent.
The bundles credit Maasea and contain their protobuf runtime and message schemas;
they do not download additional JavaScript. The module loads both scripts from
this repository's `main` branch, so remote installation requires publishing these
files there first.

## Surge configuration

Enable MITM, trust its certificate, and enable **MITM over HTTP/2** in the main
profile. Keep `auto-quic-block = true` in its `[MITM]` section (Surge iOS 5.8.0+ /
Mac 5.4.0+). [Surge's MITM documentation](https://manual.nssurge.com/http/mitm.html)
explains how this forces matching QUIC traffic back to HTTP/2 or HTTP/1.1.
These settings belong in the main profile because
[modules can only change MITM hostname and certificate-verification fields](https://manual.nssurge.com/profile/module.html).
Upstream specifies iOS/iPadOS 15+ or macOS and excludes tvOS.

The port preserves the plugin's defaults: all three button-hiding switches are
`false`, caption translation is `zh-Hans`, and debug is `false`. Caption choices
are `zh-Hans`, `zh-Hant`, `ja`, `ko`, `en`, and `off`. Use lowercase `true` or
`false` for switches. Surge receives named JSON arguments with typed booleans;
passing Loon's array would silently leave the scripts' internal defaults active.
The upstream bundles do not connect `debug` to their logger, so that retained
parameter has no effect in this snapshot.

The vendored scripts use binary bodies. `max-size=-1` avoids Surge's default buffering
limit skipping large protobuf responses, and each script has a 20-second timeout.
MITM hostnames are appended to the existing profile.

## initplayback fallback

The upstream plugin redirects `*.googlevideo.com/initplayback` (Onesie) requests
to the remote `https://init-stream.maasea.workers.dev/` service when it has a
cached key, and otherwise answers them with an empty response. With the full
upstream rule the player could hang on loading, while removing the rule let ads
through this path.
This port keeps the rule but points it at the local
[`YouTube_initplayback_empty.js`](../YouTube_initplayback_empty.js), which always
takes the upstream fallback: it drops the cached key for the current app and
returns an empty response, so the app retries through `youtubei/v1/player`,
which the response script cleans. Nothing is sent to the Worker. The copied
request script still contains the upstream redirect code, now used only for
`log_event`.

## Validation

Run `node --test tests/youtube.test.cjs` for source integrity, route parity,
argument substitution, and execution with mocked Surge
APIs. These checks do not
replace testing video playback, Shorts, Music, PiP, or translation in the apps.
