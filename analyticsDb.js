const { getCountryFlag } = require('./geoUtils');

// Initialize database schema for analytics
async function initializeAnalytics(pool) {
    try {
        const connection = await pool.getConnection();

        // 1. Visitas a páginas (Pageviews e historial)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS analytics_visits (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                visitor_id VARCHAR(64) NOT NULL,
                session_id VARCHAR(64) NOT NULL,
                path VARCHAR(255) NOT NULL,
                title VARCHAR(255) NULL,
                referrer VARCHAR(500) NULL,
                ip VARCHAR(64) NULL,
                country_code VARCHAR(10) NULL,
                country_name VARCHAR(100) NULL,
                city VARCHAR(100) NULL,
                region VARCHAR(100) NULL,
                latitude DECIMAL(10, 7) NULL,
                longitude DECIMAL(10, 7) NULL,
                device_type VARCHAR(30) NULL,
                browser_name VARCHAR(50) NULL,
                browser_version VARCHAR(30) NULL,
                os_name VARCHAR(50) NULL,
                screen_res VARCHAR(30) NULL,
                language VARCHAR(20) NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_visits_created (created_at),
                INDEX idx_visits_visitor (visitor_id),
                INDEX idx_visits_path (path),
                INDEX idx_visits_country (country_code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 2. Sesiones activas en tiempo real (Heartbeat)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS analytics_active_sessions (
                session_id VARCHAR(64) PRIMARY KEY,
                visitor_id VARCHAR(64) NOT NULL,
                current_path VARCHAR(255) NOT NULL,
                page_title VARCHAR(255) NULL,
                ip VARCHAR(64) NULL,
                country_code VARCHAR(10) NULL,
                country_name VARCHAR(100) NULL,
                city VARCHAR(100) NULL,
                device_type VARCHAR(30) NULL,
                browser_name VARCHAR(50) NULL,
                os_name VARCHAR(50) NULL,
                first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_sessions_last_seen (last_seen)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 3. Clics en anuncios (AdSense, banners, patrocinios)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS analytics_ad_clicks (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                visitor_id VARCHAR(64) NOT NULL,
                session_id VARCHAR(64) NOT NULL,
                path VARCHAR(255) NOT NULL,
                ad_network VARCHAR(50) NOT NULL,
                ad_slot VARCHAR(150) NULL,
                ip VARCHAR(64) NULL,
                country_code VARCHAR(10) NULL,
                country_name VARCHAR(100) NULL,
                city VARCHAR(100) NULL,
                device_type VARCHAR(30) NULL,
                browser_name VARCHAR(50) NULL,
                os_name VARCHAR(50) NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ad_clicks_created (created_at),
                INDEX idx_ad_clicks_network (ad_network)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        connection.release();
        console.log('✅ Tablas de estadísticas (Analytics) inicializadas correctamente.');
    } catch (error) {
        console.error('❌ Error inicializando tablas de estadísticas:', error);
        throw error;
    }
}

// Registrar una visita a página
async function recordVisit(pool, data) {
    const {
        visitorId,
        sessionId,
        path,
        title,
        referrer,
        geo,
        ua,
        screenRes,
        language
    } = data;

    try {
        // 1. Insertar en historial de visitas
        await pool.query(
            `INSERT INTO analytics_visits 
            (visitor_id, session_id, path, title, referrer, ip, country_code, country_name, city, region, latitude, longitude, device_type, browser_name, browser_version, os_name, screen_res, language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                visitorId,
                sessionId,
                path || '/',
                (title || '').substring(0, 250),
                (referrer || '').substring(0, 490),
                geo.ip,
                geo.countryCode,
                geo.countryName,
                geo.city,
                geo.region,
                geo.latitude,
                geo.longitude,
                ua.deviceType,
                ua.browserName,
                ua.browserVersion,
                ua.osName,
                screenRes || '',
                language || ''
            ]
        );

        // 2. Actualizar o insertar en sesiones activas en tiempo real
        await pool.query(
            `INSERT INTO analytics_active_sessions
            (session_id, visitor_id, current_path, page_title, ip, country_code, country_name, city, device_type, browser_name, os_name, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                current_path = VALUES(current_path),
                page_title = VALUES(page_title),
                last_seen = NOW()`,
            [
                sessionId,
                visitorId,
                path || '/',
                (title || '').substring(0, 250),
                geo.ip,
                geo.countryCode,
                geo.countryName,
                geo.city,
                ua.deviceType,
                ua.browserName,
                ua.osName
            ]
        );
    } catch (err) {
        console.error('Error registrando visita en analytics:', err);
    }
}

// Registrar un latido (heartbeat de presencia)
async function recordHeartbeat(pool, sessionId, path, title) {
    try {
        await pool.query(
            `UPDATE analytics_active_sessions 
             SET last_seen = NOW(), current_path = COALESCE(?, current_path), page_title = COALESCE(?, page_title)
             WHERE session_id = ?`,
            [path || null, title ? title.substring(0, 250) : null, sessionId]
        );
    } catch (err) {
        console.error('Error actualizando heartbeat:', err);
    }
}

// Eliminar sesión al desconectarse
async function endSession(pool, sessionId) {
    try {
        await pool.query(`DELETE FROM analytics_active_sessions WHERE session_id = ?`, [sessionId]);
    } catch (err) {
        console.error('Error finalizando sesión en analytics:', err);
    }
}

// Limpiar sesiones inactivas (más de 60 segundos sin latido)
async function cleanupInactiveSessions(pool, thresholdSeconds = 60) {
    try {
        const [result] = await pool.query(
            `DELETE FROM analytics_active_sessions WHERE last_seen < NOW() - INTERVAL ? SECOND`,
            [thresholdSeconds]
        );
        return result.affectedRows;
    } catch (err) {
        console.error('Error limpiando sesiones inactivas:', err);
        return 0;
    }
}

// Registrar clic en anuncio
async function recordAdClick(pool, data) {
    const {
        visitorId,
        sessionId,
        path,
        adNetwork,
        adSlot,
        geo,
        ua
    } = data;

    try {
        const [result] = await pool.query(
            `INSERT INTO analytics_ad_clicks
            (visitor_id, session_id, path, ad_network, ad_slot, ip, country_code, country_name, city, device_type, browser_name, os_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                visitorId,
                sessionId,
                path || '/',
                (adNetwork || 'AdSense').substring(0, 50),
                (adSlot || 'unknown').substring(0, 150),
                geo.ip,
                geo.countryCode,
                geo.countryName,
                geo.city,
                ua.deviceType,
                ua.browserName,
                ua.osName
            ]
        );
        return result.insertId;
    } catch (err) {
        console.error('Error registrando clic en anuncio:', err);
        return null;
    }
}

// Obtener usuarios activos en tiempo real
async function getActiveUsers(pool) {
    await cleanupInactiveSessions(pool, 25);

    const [rows] = await pool.query(`
        SELECT session_id, visitor_id, current_path, page_title, country_code, country_name, city, device_type, browser_name, os_name,
               TIMESTAMPDIFF(SECOND, first_seen, last_seen) as duration_seconds,
               TIMESTAMPDIFF(SECOND, last_seen, NOW()) as seconds_ago
        FROM analytics_active_sessions
        ORDER BY last_seen DESC
    `);

    const usersWithFlags = rows.map(u => ({
        ...u,
        flag: getCountryFlag(u.country_code)
    }));

    return {
        count: usersWithFlags.length,
        users: usersWithFlags
    };
}

// Construir cláusula SQL de rango temporal
function getDateFilterClause(range) {
    switch (range) {
        case 'yesterday':
            return {
                clause: 'created_at >= CURDATE() - INTERVAL 1 DAY AND created_at < CURDATE()',
                days: 1
            };
        case '7days':
            return {
                clause: 'created_at >= CURDATE() - INTERVAL 7 DAY',
                days: 7
            };
        case '30days':
            return {
                clause: 'created_at >= CURDATE() - INTERVAL 30 DAY',
                days: 30
            };
        case 'all':
            return {
                clause: '1=1',
                days: null
            };
        case 'today':
        default:
            return {
                clause: 'created_at >= CURDATE()',
                days: 1
            };
    }
}

// Obtener estadísticas completas para el Dashboard / Stats
async function getDashboardData(pool, range = 'today', osFilter = null) {
    let { clause, days } = getDateFilterClause(range);
    let osClause = '';
    if (osFilter && osFilter !== 'all' && osFilter !== 'todos') {
        // (clon) el detector a veces guarda "Mac OS" en vez de "macOS"
        osClause = osFilter === 'macOS' ? ` AND os_name IN ('macOS', 'Mac OS')` : ` AND os_name = ${pool.escape(osFilter)}`;
        clause += osClause;
    }

    // 1. Usuarios activos ahora mismo
    const active = await getActiveUsers(pool);

    // 2. Totales principales (Pageviews, Visitantes únicos, Sesiones únicas)
    const [totalsRows] = await pool.query(`
        SELECT 
            COUNT(*) as total_pageviews,
            COUNT(DISTINCT visitor_id) as unique_visitors,
            COUNT(DISTINCT session_id) as total_sessions
        FROM analytics_visits
        WHERE ${clause}
    `);
    const totals = totalsRows[0] || { total_pageviews: 0, unique_visitors: 0, total_sessions: 0 };

    // Calcular días transcurridos para promedios
    let effectiveDays = days;
    if (!effectiveDays) {
        // En caso de 'all', buscar fecha mínima
        const [minDateRow] = await pool.query(`SELECT DATEDIFF(NOW(), MIN(created_at)) + 1 as total_days FROM analytics_visits`);
        effectiveDays = (minDateRow[0] && minDateRow[0].total_days) ? Math.max(1, minDateRow[0].total_days) : 1;
    }

    const avgVisitorsPerDay = Math.round((totals.unique_visitors / effectiveDays) * 10) / 10;
    const avgPageviewsPerDay = Math.round((totals.total_pageviews / effectiveDays) * 10) / 10;
    const avgPagesPerVisit = totals.total_sessions > 0
        ? Math.round((totals.total_pageviews / totals.total_sessions) * 10) / 10
        : 0;

    // 3. Gráfica de evolución temporal
    let timelineQuery = '';
    if (range === 'today' || range === 'yesterday') {
        // Agrupado por hora del día
        timelineQuery = `
            SELECT 
                DATE_FORMAT(created_at, '%H:00') as time_label,
                COUNT(*) as visits,
                COUNT(DISTINCT visitor_id) as visitors
            FROM analytics_visits
            WHERE ${clause}
            GROUP BY DATE_FORMAT(created_at, '%H:00')
            ORDER BY MIN(created_at) ASC
        `;
    } else {
        // Agrupado por día
        timelineQuery = `
            SELECT 
                DATE_FORMAT(created_at, '%d/%m') as time_label,
                COUNT(*) as visits,
                COUNT(DISTINCT visitor_id) as visitors
            FROM analytics_visits
            WHERE ${clause}
            GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d'), DATE_FORMAT(created_at, '%d/%m')
            ORDER BY MIN(created_at) ASC
        `;
    }
    const [timelineRows] = await pool.query(timelineQuery);

    // 5. Media de usuarios por hora del día (00h a 23h) - Histórico completo o del período
    const [hourlyStatsRows] = await pool.query(`
        SELECT 
            HOUR(created_at) as hour,
            COUNT(*) as total_visits,
            COUNT(DISTINCT visitor_id) as unique_visitors
        FROM analytics_visits
        WHERE ${clause}
        GROUP BY HOUR(created_at)
        ORDER BY hour ASC
    `);

    // Rellenar las 24 horas (0 a 23)
    const hourlyDistribution = [];
    let peakHour = null;
    let peakHourVisits = 0;

    for (let h = 0; h < 24; h++) {
        const found = hourlyStatsRows.find(r => r.hour === h);
        const visits = found ? found.total_visits : 0;
        const visitors = found ? found.unique_visitors : 0;
        if (visits > peakHourVisits) {
            peakHourVisits = visits;
            peakHour = h;
        }
        hourlyDistribution.push({
            hour: `${h.toString().padStart(2, '0')}:00`,
            visits,
            visitors
        });
    }

    // 6. Países (Top 10) con banderas y porcentajes
    const [countriesRows] = await pool.query(`
        SELECT 
            country_code,
            country_name,
            COUNT(*) as visits,
            COUNT(DISTINCT visitor_id) as visitors
        FROM analytics_visits
        WHERE ${clause}
        GROUP BY country_code, country_name
        ORDER BY visits DESC
        LIMIT 10
    `);

    const topCountries = countriesRows.map(c => ({
        ...c,
        flag: getCountryFlag(c.country_code),
        percentage: totals.total_pageviews > 0
            ? Math.round((c.visits / totals.total_pageviews) * 100)
            : 0
    }));

    // 7. Top Ciudades
    const [citiesRows] = await pool.query(`
        SELECT 
            city,
            country_code,
            country_name,
            COUNT(*) as visits,
            COUNT(DISTINCT visitor_id) as visitors
        FROM analytics_visits
        WHERE ${clause} AND city IS NOT NULL AND city != '' AND city != 'Desconocida'
        GROUP BY city, country_code, country_name
        ORDER BY visits DESC
        LIMIT 15
    `);

    const topCities = citiesRows.map(c => ({
        ...c,
        flag: getCountryFlag(c.country_code),
        percentage: totals.total_pageviews > 0
            ? Math.round((c.visits / totals.total_pageviews) * 100)
            : 0
    }));

    // Puntos geográficos para el mapa interactivo (lat/long)
    const [mapPointsRows] = await pool.query(`
        SELECT 
            city,
            country_code,
            country_name,
            latitude,
            longitude,
            COUNT(*) as visits
        FROM analytics_visits
        WHERE ${clause} AND latitude IS NOT NULL AND longitude IS NOT NULL
        GROUP BY city, country_code, country_name, latitude, longitude
        ORDER BY visits DESC
        LIMIT 60
    `);

    // 8. Páginas más visitadas (Top Pages)
    const [pagesRows] = await pool.query(`
        SELECT 
            path,
            COALESCE(MAX(title), path) as title,
            COUNT(*) as visits,
            COUNT(DISTINCT visitor_id) as unique_visitors
        FROM analytics_visits
        WHERE ${clause}
        GROUP BY path
        ORDER BY visits DESC
        LIMIT 10
    `);

    const topPages = pagesRows.map(p => ({
        ...p,
        percentage: totals.total_pageviews > 0
            ? Math.round((p.visits / totals.total_pageviews) * 100)
            : 0
    }));

    // 9. Dispositivos (Móvil, Escritorio, Tablet)
    const [devicesRows] = await pool.query(`
        SELECT 
            device_type,
            COUNT(*) as count
        FROM analytics_visits
        WHERE ${clause}
        GROUP BY device_type
        ORDER BY count DESC
    `);

    // 10. Navegadores y Sistemas Operativos
    const [browsersRows] = await pool.query(`
        SELECT 
            browser_name,
            COUNT(*) as count
        FROM analytics_visits
        WHERE ${clause} AND browser_name IS NOT NULL AND browser_name != ''
        GROUP BY browser_name
        ORDER BY count DESC
        LIMIT 6
    `);

    const [osRows] = await pool.query(`
        SELECT 
            os_name,
            COUNT(*) as count
        FROM analytics_visits
        WHERE ${clause} AND os_name IS NOT NULL AND os_name != ''
        GROUP BY os_name
        ORDER BY count DESC
        LIMIT 6
    `);

    // 11. Feed de últimas visitas en vivo (Live Feed)
    const [recentVisitsRows] = await pool.query(`
        SELECT 
            id,
            path,
            title,
            country_code,
            country_name,
            city,
            device_type,
            browser_name,
            os_name,
            created_at
        FROM analytics_visits
        ORDER BY created_at DESC
        LIMIT 15
    `);

    const recentVisitsWithFlags = recentVisitsRows.map(v => ({
        ...v,
        flag: getCountryFlag(v.country_code)
    }));

    // (clon) 12. Periodo anterior equivalente (para comparar)
    const prevClauses = {
        today: 'created_at >= CURDATE() - INTERVAL 1 DAY AND created_at < NOW() - INTERVAL 1 DAY',
        yesterday: 'created_at >= CURDATE() - INTERVAL 2 DAY AND created_at < CURDATE() - INTERVAL 1 DAY',
        '7days': 'created_at >= CURDATE() - INTERVAL 14 DAY AND created_at < CURDATE() - INTERVAL 7 DAY',
        '30days': 'created_at >= CURDATE() - INTERVAL 60 DAY AND created_at < CURDATE() - INTERVAL 30 DAY'
    };
    let previousTotals = null;
    if (prevClauses[range]) {
        const [prevRows] = await pool.query(`
            SELECT COUNT(*) as pageviews, COUNT(DISTINCT visitor_id) as uniqueVisitors, COUNT(DISTINCT session_id) as sessions
            FROM analytics_visits WHERE ${prevClauses[range]}${osClause}
        `);
        previousTotals = prevRows[0] || null;
    }

    // (clon) 13. Juegos más jugados (por sesiones que entran a /game/<juego>/...)
    const [gamesRows] = await pool.query(`
        SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(path, '/', 3), '/', -1) as game,
               COUNT(DISTINCT session_id) as sessions,
               COUNT(*) as visits
        FROM analytics_visits
        WHERE ${clause} AND path LIKE '/game/%'
        GROUP BY game
        ORDER BY sessions DESC
        LIMIT 12
    `);

    // (clon) 14. De dónde vienen (dominio de referencia, agrupando apps conocidas)
    const [refRows] = await pool.query(`
        SELECT LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(referrer, '/', 3), '://', -1), ':', 1)) as host,
               COUNT(DISTINCT session_id) as sessions
        FROM analytics_visits
        WHERE ${clause}
        GROUP BY host
        ORDER BY sessions DESC
        LIMIT 40
    `);
    const sourceOf = (host) => {
        if (!host) return 'Directo / enlace';
        if (/juegosbeber/.test(host) || /^localhost$|^127\./.test(host)) return null;
        if (/whatsapp|wa\.me|l\.wl\.co/.test(host)) return 'WhatsApp';
        if (/instagram/.test(host)) return 'Instagram';
        if (/tiktok/.test(host)) return 'TikTok';
        if (/facebook|fb\.com|fb\.me/.test(host)) return 'Facebook';
        if (/(^|\.)t\.co$|twitter|x\.com/.test(host)) return 'X / Twitter';
        if (/google/.test(host)) return 'Google';
        if (/bing|duckduckgo|yahoo|ecosia/.test(host)) return 'Otros buscadores';
        if (/telegram|t\.me/.test(host)) return 'Telegram';
        if (/youtube/.test(host)) return 'YouTube';
        return host.replace(/^www\./, '');
    };
    const refMap = {};
    refRows.forEach(r => { const src = sourceOf(r.host); if (src) refMap[src] = (refMap[src] || 0) + Number(r.sessions); });
    const topReferrers = Object.entries(refMap).map(([source, sessions]) => ({ source, sessions })).sort((a, b) => b.sessions - a.sessions).slice(0, 8);

    return {
        range,
        previousTotals,
        topGames: gamesRows,
        topReferrers,
        activeUsersCount: active.count,
        activeUsersList: active.users,
        totals: {
            pageviews: totals.total_pageviews,
            uniqueVisitors: totals.unique_visitors,
            sessions: totals.total_sessions,
            avgVisitorsPerDay,
            avgPageviewsPerDay,
            avgPagesPerVisit,
            peakHourFormatted: (peakHour !== null && peakHourVisits > 0)
                ? `${peakHour.toString().padStart(2, '0')}:00 - ${(peakHour + 1).toString().padStart(2, '0')}:00`
                : '--:--'
        },
        timeline: timelineRows,
        hourlyDistribution,
        topCountries,
        topCities,
        mapPoints: mapPointsRows,
        topPages,
        devices: devicesRows,
        browsers: browsersRows,
        operatingSystems: osRows,
        recentVisits: recentVisitsWithFlags
    };
}

// Borrar todas las estadísticas para empezar de nuevo limpiamente
async function resetAnalytics(pool) {
    try {
        await pool.query('TRUNCATE TABLE analytics_visits');
        await pool.query('TRUNCATE TABLE analytics_active_sessions');
        await pool.query('TRUNCATE TABLE analytics_ad_clicks');
        return true;
    } catch (err) {
        console.error('Error vaciando tablas de analíticas:', err);
        throw err;
    }
}

module.exports = {
    initializeAnalytics,
    recordVisit,
    recordHeartbeat,
    endSession,
    cleanupInactiveSessions,
    recordAdClick,
    getActiveUsers,
    getDashboardData,
    resetAnalytics
};
