/* オフライン用キャッシュ。アプリ本体を更新したら CACHE_VERSION を上げる */
const CACHE_VERSION = 'kinjishi-v0.3.0';
const DATA_URL = 'data/questions.json';
const PRECACHE = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'manifest.webmanifest',
  DATA_URL,
  'fonts/ZenAntique-subset.woff2',
  'fonts/BodoniModa-subset.woff2',
  'img/lion_gold.svg',
  'img/lion_silver.svg',
  'img/lion_bronze.svg',
  'img/lion_black.svg',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/icon-maskable-512.png',
  'img/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 問題データ：オンラインなら常に最新を取りに行き、キャッシュを置き換える
  if (url.pathname.endsWith('/' + DATA_URL)) {
    event.respondWith(networkFirst(req));
    return;
  }
  // ページ本体：CSS・JS と同じく「キャッシュを即座に返し、裏で更新」にそろえる。
  // HTML だけ新しく JS・CSS は古い、という食い違いを防ぐため（更新は次回起動からまとめて反映）
  if (req.mode === 'navigate') {
    event.respondWith(
      staleWhileRevalidate(req, event).catch(() => caches.match('index.html'))
    );
    return;
  }
  // それ以外：キャッシュを即座に返し、裏で新しい版に入れ替える（次回起動から反映）
  event.respondWith(staleWhileRevalidate(req, event));
});

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req).then((res) => {
    if (res.ok) return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
