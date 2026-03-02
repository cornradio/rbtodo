const CACHE_NAME = 'rbtodo-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/css/base.css',
    '/css/sidebar.css',
    '/css/todo.css',
    '/css/editor.css',
    '/css/overlay.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Outfit:wght@300;400;500;600&display=swap',
    'https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((history) => {
            return Promise.all(
                history.map((name) => {
                    if (cacheWhitelist.indexOf(name) === -1) {
                        return caches.delete(name);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Skip non-GET requests and API requests for caching
    if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // If network works, update cache and return
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // If network fails, try cache
                return caches.match(event.request);
            })
    );
});
