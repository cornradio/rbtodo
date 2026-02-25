const CACHE_NAME = 'rbtodo-v1';
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

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
