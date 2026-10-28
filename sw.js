/**
 * v12：素材快取（Service Worker）
 * 為什麼：GitHub Pages 只讓瀏覽器把檔案記 10 分鐘，之後每張圖都要再問一次伺服器「有沒有更新」；
 *         一招演出有 100～600 張圖，光是一張一張問就要好幾秒，所以「看過的招式還是要等」。
 * 做法：圖片、音效（assets/、anim/assets/）下載過一次就存在玩家電腦裡，之後直接拿，不再問伺服器。
 *       網頁、程式、JSON 仍然每次先問伺服器（這樣更新遊戲時玩家會拿到新版）。
 * 更新素材時：把 CACHE 的版本號改掉，舊的快取會自動刪除。
 */
const CACHE = 'srw-ch1-assets-v19';   // v19：封面圖更新過，換版本號讓舊快取作廢
const ASSET = /\/(anim\/)?assets\/.+\.(webp|png|jpg|mp3)$/i;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('srw-ch1-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !ASSET.test(new URL(req.url).pathname)) return;   // 其他檔案照瀏覽器原本的方式
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: false });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  }));
});
