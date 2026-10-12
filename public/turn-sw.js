/* JuegosBeber · service worker de avisos de turno (solo para /game/).
   No guarda nada en caché ni intercepta peticiones: solo enseña la
   notificación de "te toca" y, al pulsarla, vuelve a la partida. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const same = list.find((c) => c.url.split('#')[0] === url.split('#')[0]);
        if (same) return same.focus();
        return self.clients.openWindow(url);
    })());
});
