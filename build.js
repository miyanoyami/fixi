#!/usr/bin/env node
'use strict';

/**
 * build.js — fixi ビルドスクリプト
 *
 * 概要:
 *   1. dist/ に viewer・data・config.json をコピー
 *   2. data 内の user.json の body/bio を AES-GCM で暗号化
 *   3. config.json に buildDate を追記（viewer 側の復号鍵として使用）
 *   4. sample/ / admin.html / generator/ / build.js は dist/ に含めない
 *
 * 使い方:
 *   node build.js
 *   node build.js --out ./dist   # 出力先を指定（デフォルト: ./dist）
 *
 * 鍵導出:
 *   HKDF(SHA-256, ikm = siteName + "|" + baseDate + "|" + buildDate)
 */

const fs   = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;
const getRandomValues = (buf) => webcrypto.getRandomValues(buf);

const ROOT    = path.resolve(__dirname);
const args    = process.argv.slice(2);
const outIdx  = args.indexOf('--out');
const DIST    = path.resolve(outIdx !== -1 ? args[outIdx + 1] : path.join(ROOT, 'dist'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }

function copyDir(src, dest, exclude = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

async function deriveKey(siteName) {
  const enc = new TextEncoder();
  const ikm = enc.encode(siteName);
  const salt = enc.encode('fixi-salt-v1');
  const info = enc.encode('fixi-aes-gcm');

  const baseKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(key, plaintext) {
  const enc = new TextEncoder();
  const iv  = getRandomValues(new Uint8Array(12));
  const ct  = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  // iv(12B) + ciphertext を Base64 で返す
  const combined = new Uint8Array(12 + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), 12);
  return Buffer.from(combined).toString('base64');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 出力先をクリア
  if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  // config.json 読み込み
  const config = readJSON(path.join(ROOT, 'config.json'));
  const buildDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const siteName  = config.siteName || '';
  const baseDate  = config.baseDate || '';

  // 鍵導出
  console.log(`Deriving key from: "${siteName}"`);
  const key = await deriveKey(siteName);

  // viewer/ をコピー
  copyDir(path.join(ROOT, 'viewer'), path.join(DIST, 'viewer'));

  // index.html をコピー
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));

  // config.json に buildDate を付けて出力
  const distConfig = { ...config, buildDate };
  writeJSON(path.join(DIST, 'config.json'), distConfig);

  // data/ を処理（user.json の body/bio を暗号化）
  const dataDir     = path.join(ROOT, 'data');
  const distDataDir = path.join(DIST, 'data');
  fs.mkdirSync(distDataDir, { recursive: true });

  // index.json はそのままコピー
  fs.copyFileSync(path.join(dataDir, 'index.json'), path.join(distDataDir, 'index.json'));

  const index = readJSON(path.join(dataDir, 'index.json'));
  let totalPosts = 0;

  for (const userKey of index.users) {
    const srcUserDir  = path.join(dataDir, userKey);
    const distUserDir = path.join(distDataDir, userKey);
    fs.mkdirSync(distUserDir, { recursive: true });

    // 画像・動画などバイナリファイルはそのままコピー
    for (const f of fs.readdirSync(srcUserDir)) {
      if (f === 'user.json') continue;
      fs.copyFileSync(path.join(srcUserDir, f), path.join(distUserDir, f));
    }

    // user.json を暗号化して出力
    const userFile = path.join(srcUserDir, 'user.json');
    if (!fs.existsSync(userFile)) continue;

    const user = readJSON(userFile);

    // bio を暗号化
    if (user.bio) user.bio = await encryptText(key, user.bio);

    // posts の body を暗号化
    for (const post of (user.posts || [])) {
      if (post.body) post.body = await encryptText(key, post.body);
    }

    writeJSON(path.join(distUserDir, 'user.json'), user);
    totalPosts += (user.posts || []).length;
  }

  console.log(`Encrypted ${index.users.length} users, ${totalPosts} posts`);
  console.log(`Output: ${DIST}`);
  console.log(`buildDate (saved in dist/config.json): ${buildDate}`);
}

main().catch(e => { console.error(e); process.exit(1); });
