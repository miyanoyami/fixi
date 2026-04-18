#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SAMPLE_DIR = path.join(ROOT, 'sample', 'patterns');
const ICONS_DIR = path.join(ROOT, 'sample', 'icons');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    }
  }
  return args;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// data/index.json helpers
// ---------------------------------------------------------------------------

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) return { users: [] };
  return readJSON(INDEX_FILE);
}

function saveIndex(index) {
  writeJSON(INDEX_FILE, index);
}

function addUserToIndex(key) {
  const index = loadIndex();
  if (!index.users.includes(key)) {
    index.users.push(key);
    saveIndex(index);
  }
}

// ---------------------------------------------------------------------------
// Command: create-user
// ---------------------------------------------------------------------------

function createUser(args) {
  const { key, name, bio = '' } = args;

  if (!key) { console.error('Error: --key is required'); process.exit(1); }
  if (!name) { console.error('Error: --name is required'); process.exit(1); }

  const userDir = path.join(DATA_DIR, key);
  const userFile = path.join(userDir, 'user.json');

  if (fs.existsSync(userFile)) {
    console.error(`Error: user "${key}" already exists. Use --force to overwrite.`);
    if (!args.force) process.exit(1);
  }

  fs.mkdirSync(userDir, { recursive: true });

  const user = {
    key,
    name,
    bio,
    createdOffset: -randomInt(86400 * 30, 86400 * 365),
    following: [],
    followers: [],
    posts: []
  };

  writeJSON(userFile, user);
  addUserToIndex(key);

  console.log(`Created user: ${key}`);
}

// ---------------------------------------------------------------------------
// Command: add-posts
// ---------------------------------------------------------------------------

function loadPatterns(category) {
  const files = fs.readdirSync(SAMPLE_DIR).filter(f => f.endsWith('.json'));
  let patterns = [];

  for (const file of files) {
    const data = readJSON(path.join(SAMPLE_DIR, file));
    if (!category || data.category === category) {
      patterns = patterns.concat(data.patterns);
    }
  }

  if (patterns.length === 0) {
    console.error(`Error: no patterns found${category ? ` for category "${category}"` : ''}`);
    process.exit(1);
  }

  return patterns;
}

function applyPlaceholders(body, user) {
  return body.replace(/\{name\}/g, user.name);
}

// ユーザーキーから決定論的な「個性」パラメータを生成
function getUserPersonality(key) {
  // キーの文字コード和でシードを作る
  const seed = key.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const r = (n) => seed % n;

  const suffixSets = [
    [],           // 何も付けない（最多）
    [],
    [],
    ['笑'],
    ['…'],
    ['。'],
    ['！'],
    ['ね'],
    ['な'],
    ['〜'],
    ['w'],
    ['ww'],
    ['草'],
  ];
  const prefixSets = [
    '',   // 何も付けない（最多）
    '',
    '',
    '',
    'あー',
    'うーん、',
    'なんか',
    'でも',
    'やっぱ',
    'まあ',
  ];
  const emojis = ['', '', '', '', '', '😂', '😭', '😅', '🙃', '🥲', '💦', '✌️', '👍', '🙄'];

  return {
    suffixes: suffixSets[r(suffixSets.length)],
    prefix: prefixSets[r(prefixSets.length)],
    emoji: emojis[r(emojis.length)],
    // 語尾変換スタイル: 0=そのまま 1=だ→だよ 2=だ→だね 3=た→たよ
    conjugation: r(4),
  };
}

function applyPersonality(body, personality) {
  let text = body;

  // 語尾変換
  if (personality.conjugation === 1) {
    text = text.replace(/だ$/, 'だよ').replace(/だ。$/, 'だよ。');
  } else if (personality.conjugation === 2) {
    text = text.replace(/だ$/, 'だね').replace(/だ。$/, 'だね。');
  } else if (personality.conjugation === 3) {
    text = text.replace(/た$/, 'たよ').replace(/た。$/, 'たよ。');
  }

  // 前置き（確率的に付与）
  if (personality.prefix && Math.random() < 0.3) {
    text = personality.prefix + text;
  }

  // 語尾suffix（確率的に付与）
  if (personality.suffixes && personality.suffixes.length > 0 && Math.random() < 0.4) {
    // 末尾に既に句読点や記号がある場合は付けない
    if (!/[。！？…wW草笑\n]$/.test(text)) {
      text = text + personality.suffixes;
    }
  }

  // 絵文字（確率的に付与）
  if (personality.emoji && Math.random() < 0.2) {
    text = text + personality.emoji;
  }

  return text;
}

function addPosts(args) {
  const key = args.key;
  const count = parseInt(args.count, 10);
  const category = args.category || null;
  const replyRate = parseFloat(args['reply-rate'] ?? 0.2);

  if (!key) { console.error('Error: --key is required'); process.exit(1); }
  if (!count || isNaN(count) || count < 1) { console.error('Error: --count must be a positive integer'); process.exit(1); }

  const userFile = path.join(DATA_DIR, key, 'user.json');
  if (!fs.existsSync(userFile)) {
    console.error(`Error: user "${key}" does not exist. Run create-user first.`);
    process.exit(1);
  }

  const user = readJSON(userFile);
  const personality = getUserPersonality(key);
  const patterns = loadPatterns(category);
  const shuffled = shuffle(patterns);

  // Collect other users' posts as reply candidates
  const index = loadIndex();
  const otherPosts = index.users
    .filter(k => k !== key)
    .flatMap(k => {
      const f = path.join(DATA_DIR, k, 'user.json');
      if (!fs.existsSync(f)) return [];
      return readJSON(f).posts || [];
    });

  // 目標期間: 2年(730日)。ユーザーごとに開始点を最大90日ばらつかせる
  const TWO_YEARS_SEC = 86400 * 730;
  const startSpread = randomInt(0, 86400 * 90);
  const spanSec = TWO_YEARS_SEC - startSpread; // このユーザーがカバーする秒数

  // 平均間隔 = span / count。そこを中心に ±50% のランダム幅を持たせる
  const avgGap = Math.floor(spanSec / count);
  const minGap = Math.max(600, Math.floor(avgGap * 0.5));
  const maxGap = Math.floor(avgGap * 1.5);

  // Determine starting offset (continue from last post, or start ~2yr before baseDate)
  let currentOffset = user.posts.length > 0
    ? Math.min(...user.posts.map(p => p.offset))
    : -(spanSec);

  let counter = user.posts.length;

  const newPosts = [];
  for (let i = 0; i < count; i++) {
    currentOffset += randomInt(minGap, maxGap); // 過去→現在方向に進める
    // baseDateを超えないようにクランプ
    if (currentOffset > -600) currentOffset = -randomInt(600, 7200);

    const pattern = shuffled[i % shuffled.length];
    const body = applyPersonality(applyPlaceholders(pattern.body, user), personality);

    // Determine replyTo: pick from own + other users' posts
    let replyTo = null;
    const replyPool = [...user.posts, ...newPosts, ...otherPosts];
    if (replyRate > 0 && replyPool.length > 0 && Math.random() < replyRate) {
      replyTo = pick(replyPool).id;
    }

    const id = `${key}_${String(counter++).padStart(4, '0')}`;
    newPosts.push({ id, body, offset: currentOffset, replyTo, media: null });
  }

  user.posts = [...user.posts, ...newPosts];
  writeJSON(userFile, user);

  console.log(`Added ${newPosts.length} posts to user "${key}" (total: ${user.posts.length})`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const [, , command, ...rest] = process.argv;
const args = parseArgs(rest);

switch (command) {
  case 'create-user':
    createUser(args);
    break;
  case 'add-posts':
    addPosts(args);
    break;
  default:
    console.error('Usage:');
    console.error('  node generator/scripts.js create-user --key <key> --name <name> [--bio <bio>]');
    console.error('  node generator/scripts.js add-posts --key <key> --count <n> [--category <cat>] [--reply-rate <0.0-1.0>]');
    process.exit(1);
}
