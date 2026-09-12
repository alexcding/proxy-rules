const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const moduleText = read('youtube.sgmodule');
const defaults = Object.fromEntries(moduleText.match(/^#!arguments=(.+)$/m)[1]
  .split(',').map((part) => part.trim().split(':')));
const rules = moduleText.split('\n').filter((line) => /^youtube\./.test(line));
const argument = (rule, overrides = {}) => rule.match(/argument="(.*)"$/)[1]
  .replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => ({ ...defaults, ...overrides })[key]);

function run(rule, { url, headers = {}, body = new Uint8Array(), config = {}, overrides = {} } = {}) {
  const calls = [];
  const logs = [];
  const store = { YouTubeConfig: JSON.stringify(config) };
  const sourceFile = rule.match(/script-path=[^,]+\/([^/,]+),/)[1];
  const context = {
    Uint8Array, ArrayBuffer, TextEncoder, TextDecoder,
    $argument: argument(rule, overrides),
    $request: { url, method: 'POST', headers: { 'User-Agent': 'com.google.ios.youtube/21.0', ...headers }, body },
    $response: { status: 200, headers: {}, body },
    $persistentStore: {
      read: (key) => store[key] ?? null,
      write: (value, key) => { store[key] = value; return true; },
    },
    $notification: { post: () => assert.fail('Unexpected notification') },
    $httpClient: new Proxy({}, { get: () => () => assert.fail('Unexpected network call') }),
    $done: (result) => calls.push(result),
    console: { log: (...args) => logs.push(args.join(' ')) },
  };
  vm.runInNewContext(read(sourceFile), context, { timeout: 2000, filename: sourceFile });
  assert.equal(calls.length, 1, 'Script must finish exactly once');
  return { result: calls[0], store, logs };
}

test('vendored sources retain the downloaded bytes', () => {
  for (const [file, hash] of Object.entries({
    'YouTube_remove_ads_request.js': 'af0646890f9847aa4576181b0637e31b86a3e2f6dd4d2041a56ffa971aacc10b',
    'YouTube_remove_ads_response.js': 'b926d339069a8f54e84bd5d29e8c8364ee9ea72bb170197e281b04eda49e3568',
    'vendor/efzb-wx/loon/YoutubeBlock/YouTube_remove_ads.lpx': 'ba56b06e26d87e1f77966006aad1c73a0930dd344dfbf2cafe2f247eecf4fc55',
  })) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex'), hash);
  }
});

test('all upstream routes use local repository scripts and binary bodies', () => {
  const original = read('vendor/efzb-wx/loon/YoutubeBlock/YouTube_remove_ads.lpx')
    .split('\n').filter((line) => /^http-(request|response) /.test(line));
  assert.equal(rules.length, 3);
  rules.forEach((rule, index) => {
    const [, type, pattern] = original[index].match(/^(http-\w+) (\S+)/);
    assert.ok(rule.includes(`type=${type}, pattern=${pattern},`));
    new RegExp(pattern);
    assert.ok(rule.includes('script-path=https://raw.githubusercontent.com/alexcding/proxy-rules/refs/heads/main/'));
    assert.ok(rule.includes('requires-body=true, binary-body-mode=true'));
  });
  assert.match(moduleText, /hostname = %APPEND% \*\.googlevideo\.com, youtubei\.googleapis\.com/);
});

test('Surge substitutions yield named JSON values, preserving Loon defaults', () => {
  assert.deepEqual(JSON.parse(argument(rules[0])), {
    blockUpload: false, blockShorts: false, blockImmersive: false, captionLang: 'zh-Hans', debug: false,
  });
  assert.deepEqual(JSON.parse(argument(rules[1])), { captionLang: 'zh-Hans' });
  for (const lang of ['zh-Hans', 'zh-Hant', 'ja', 'ko', 'en', 'off']) {
    const result = JSON.parse(argument(rules[2], { captionLang: lang, blockUpload: 'true' }));
    assert.equal(result.captionLang, lang);
    assert.equal(result.blockUpload, true);
  }
});

test('log_event strips encoding and removes hot-hash only without a cached key', () => {
  for (const cached of [false, true]) {
    const { result, logs } = run(rules[2], {
      url: 'https://youtubei.googleapis.com/youtubei/v1/log_event',
      headers: { 'Content-Encoding': 'gzip', 'X-YouTube-Hot-Hash-Data': 'hash', Accept: '*/*' },
      config: cached ? { youtube: { clientKey: 'key' } } : {},
    });
    assert.equal(result.headers['Content-Encoding'], undefined);
    assert.equal(result.headers['X-YouTube-Hot-Hash-Data'], cached ? 'hash' : undefined);
    assert.equal(result.headers.Accept, '*/*');
    assert.deepEqual(logs, []);
  }
});

test('initplayback forwards the selected caption language with a matching protobuf key', () => {
  const url = 'https://rr1.googlevideo.com/initplayback?foo=1&ack=1';
  const { result, logs } = run(rules[1], {
    url,
    // OnesieRequest field 3 -> EncryptedInnertubeRequest field 5 -> key byte 1.
    body: Uint8Array.from([26, 3, 42, 1, 1]),
    config: { youtube: { clientKey: 'client-key', encryptKey: 'AQ==' } },
    overrides: { captionLang: 'ja' },
  });
  const redirect = new URL(result.url);
  assert.equal(redirect.origin, 'https://init-stream.maasea.workers.dev');
  assert.equal(redirect.searchParams.get('target'), url);
  assert.equal(redirect.searchParams.get('ck'), 'client-key');
  assert.equal(redirect.searchParams.get('captionLang'), 'ja');
  assert.deepEqual(logs, []);
});

test('initplayback clears stale video keys and returns an empty binary response', () => {
  const { result, store, logs } = run(rules[1], {
    url: 'https://rr1.googlevideo.com/initplayback?foo=1&ack=1',
    body: Uint8Array.from([26, 3, 42, 1, 2]),
    config: { youtube: { clientKey: 'key', encryptKey: 'AQ==' }, youtubeMusic: { clientKey: 'music' } },
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.response.body instanceof Uint8Array);
  assert.equal(result.response.body.length, 0);
  assert.deepEqual(JSON.parse(store.YouTubeConfig), { youtubeMusic: { clientKey: 'music' } });
  assert.deepEqual(logs, []);
});

test('response script returns a binary settings rewrite through Surge APIs', () => {
  const { result, logs } = run(rules[0], {
    url: 'https://youtubei.googleapis.com/youtubei/v1/account/get_setting',
  });
  assert.ok(result.body instanceof Uint8Array);
  assert.ok(result.body.length > 0);
  assert.equal(result.bodyBytes, undefined);
  assert.deepEqual(logs, []);
});

test('malformed protobuf responses pass through without replacing the body', () => {
  const { result, logs } = run(rules[0], {
    url: 'https://youtubei.googleapis.com/youtubei/v1/player',
    body: Uint8Array.from([255]),
  });
  assert.equal(Object.keys(result).length, 0);
  assert.equal(logs.length, 1);
});
