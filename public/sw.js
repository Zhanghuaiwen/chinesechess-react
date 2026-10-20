/* 中国象棋 PWA Service Worker
 * 缓存策略：
 *  1) App Shell 预缓存：首屏 HTML、manifest、图标 —— 保证离线也能打开应用外壳；
 *  2) 导航请求：网络优先，失败时回退已缓存的 Shell；
 *  3) 引擎资源（/pikafish/ 下的 js/wasm）：缓存优先，体积大且随构建哈希更新；
 *  4) 其它同源静态资源（Vite 产出的 js/css 等）：stale-while-revalidate。
 * 非 GET 请求与跨域请求（例如 ws:// 联机服务）一律交给浏览器处理。
 */

const VERSION = 'v1';
const SHELL_CACHE = `cc-shell-${VERSION}`;
const RUNTIME_CACHE = `cc-runtime-${VERSION}`;

// Shell 入口用 '/' 作为键，离线导航统一回退到这里。
const SHELL_URL = '/';
const SHELL_ASSETS = [
  SHELL_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // 单个资源失败不阻断安装（例如某张图标暂不可用）。
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // 跨域（含 ws/wss 联机）与开发态 Vite 内部请求不接管。
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/vite') || url.pathname.startsWith('/@')) return;

  // 导航：网络优先，离线回退 Shell。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL_URL).then((hit) => hit || caches.match('/index.html'))),
    );
    return;
  }

  // 引擎 wasm/js：缓存优先。
  if (url.pathname.startsWith('/pikafish/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 其它静态资源：stale-while-revalidate —— 先给缓存保证速度，后台静默拉新版本。
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
            }
          })
          .catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => new Response('offline', { status: 504, statusText: 'Offline' }));
    }),
  );
});
