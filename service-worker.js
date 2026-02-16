// Simple service worker for offline caching of core assets.
// This worker caches the application shell (HTML, CSS, JS) so the app
// can start offline. It uses a network‑first strategy for all requests,
// falling back to the cache if the network is unreachable. Additional
// caching strategies (e.g. stale‑while‑revalidate) can be added as
// needed.

const CACHE_NAME = 'photolab-cache-v1';
// List of URLs to precache during installation. When adding new assets
// (e.g. new scripts), update this array to include them. In hybrid mode
// we also cache local ONNX model weights so they are available offline.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/src/main.js',
  '/src/orchestrator.js',
  '/src/models/loader.js',
  '/src/utils.js',
  '/src/utils/fileSystem.js',
  '/src/utils/videoExporter.js',
  '/libs/ort.min.js',
  '/libs/ffmpeg.min.js',
  // Precache Three.js stub so the 3D reconstruction blueprint can load it
  '/libs/three.min.js',
  '/src/workers/aiOrtWorker.js',
  '/src/workers/imageProcessingWorker.js',
  '/src/workers/objectDetectionWorker.js',
  '/src/backend/mockBackend.js',
  '/src/utils/sync.js',

  // Precache ONNX model weights for offline inference. Although these
  // files can be large, caching them ensures the application functions
  // without a network connection. If models are updated you should
  // bump the CACHE_NAME to force a refresh.
  '/models/super_resolution.onnx',
  '/models/super_resolution_2x.onnx',
  '/models/retinaface.onnx',
  '/models/gfpgan_lite.onnx',
  '/models/arcface.onnx',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Cleanup old caches if the cache name changes
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Skip cross‑origin requests (like CDN) to avoid CORS errors
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and store in cache for future offline use
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // On network failure, try to serve from cache
        return caches.match(event.request);
      })
  );
});