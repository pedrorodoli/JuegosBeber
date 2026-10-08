/**
 * JuegosBeber.es - Realtime Analytics & Ad Click Tracker
 * Lightweight, zero-dependency, non-intrusive tracker.
 */
(function () {
    // Ignorar en entornos no de navegador
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    // Ignorar el propio panel de estadísticas para no falsear métricas
    if (window.location.pathname.startsWith('/dashboard') || window.location.pathname.startsWith('/stats')) {
        return;
    }

    // Generar o recuperar ID de visitante persistente (localStorage)
    function getVisitorId() {
        let vid = null;
        try {
            vid = localStorage.getItem('_jb_vid');
            if (!vid) {
                vid = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
                localStorage.setItem('_jb_vid', vid);
            }
        } catch (e) {
            vid = 'v_temp_' + Math.random().toString(36).substring(2, 9);
        }
        return vid;
    }

    // Generar o recuperar ID de sesión (sessionStorage)
    function getSessionId() {
        let sid = null;
        try {
            sid = sessionStorage.getItem('_jb_sid');
            if (!sid) {
                sid = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
                sessionStorage.setItem('_jb_sid', sid);
            }
        } catch (e) {
            sid = 's_temp_' + Math.random().toString(36).substring(2, 9);
        }
        return sid;
    }

    const visitorId = getVisitorId();
    const sessionId = getSessionId();

    // Enviar datos al servidor de forma segura
    function sendPayload(url, data, useBeaconOnly = false) {
        const payload = JSON.stringify(data);
        if (useBeaconOnly && navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
            return;
        }

        if (typeof fetch === 'function') {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true
            }).catch(function () {
                // Silenciar errores de conexión
            });
        } else if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
        }
    }

    // 1. Registrar Pageview
    function trackPageView() {
        const screenRes = (window.screen.width || 0) + 'x' + (window.screen.height || 0);
        sendPayload('/api/analytics/pageview', {
            visitorId: visitorId,
            sessionId: sessionId,
            path: window.location.pathname + window.location.search,
            title: document.title,
            referrer: document.referrer || '',
            screenRes: screenRes,
            language: navigator.language || ''
        });
    }

    // 2. Heartbeat periódico para usuarios activos en tiempo real (cada 8 segundos)
    let heartbeatInterval = null;
    function startHeartbeat() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(function () {
            if (document.visibilityState === 'visible') {
                sendPayload('/api/analytics/heartbeat', {
                    visitorId: visitorId,
                    sessionId: sessionId,
                    path: window.location.pathname + window.location.search,
                    title: document.title
                });
            }
        }, 8000);
    }

    // 3. Notificar fin de sesión al salir (desconexión instantánea)
    function notifySessionEnd() {
        sendPayload('/api/analytics/session-end', {
            sessionId: sessionId
        }, true);
    }

    function handleVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            notifySessionEnd();
        } else if (document.visibilityState === 'visible') {
            sendPayload('/api/analytics/heartbeat', {
                visitorId: visitorId,
                sessionId: sessionId,
                path: window.location.pathname,
                title: document.title
            });
        }
    }

    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            trackPageView();
            startHeartbeat();
        });
    } else {
        trackPageView();
        startHeartbeat();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', notifySessionEnd);
    window.addEventListener('beforeunload', notifySessionEnd);

    // Exponer API para eventos personalizados
    window.jbAnalytics = {
        trackEvent: function (eventName, eventData) {
            sendPayload('/api/analytics/event', {
                visitorId: visitorId,
                sessionId: sessionId,
                path: window.location.pathname,
                eventName: eventName,
                eventData: eventData
            });
        }
    };
})();
