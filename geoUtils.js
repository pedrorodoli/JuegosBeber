const geoip = require('geoip-lite');
const { UAParser } = require('ua-parser-js');

// Spanish names for common countries
const COUNTRY_NAMES_ES = {
    'ES': 'España',
    'MX': 'México',
    'AR': 'Argentina',
    'CO': 'Colombia',
    'CL': 'Chile',
    'PE': 'Perú',
    'US': 'Estados Unidos',
    'VE': 'Venezuela',
    'EC': 'Ecuador',
    'GT': 'Guatemala',
    'CU': 'Cuba',
    'BO': 'Bolivia',
    'DO': 'Rep. Dominicana',
    'HN': 'Honduras',
    'PY': 'Paraguay',
    'SV': 'El Salvador',
    'NI': 'Nicaragua',
    'CR': 'Costa Rica',
    'PA': 'Panamá',
    'UY': 'Uruguay',
    'PR': 'Puerto Rico',
    'FR': 'Francia',
    'DE': 'Alemania',
    'IT': 'Italia',
    'GB': 'Reino Unido',
    'PT': 'Portugal',
    'BR': 'Brasil',
    'CA': 'Canadá'
};

function getCountryFlag(code) {
    if (!code || code.length !== 2) return '🌐';
    try {
        return code
            .toUpperCase()
            .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
    } catch (e) {
        return '🌐';
    }
}

function getCountryName(code) {
    if (!code) return 'Desconocido';
    const upper = code.toUpperCase();
    return COUNTRY_NAMES_ES[upper] || upper;
}

function getClientIp(req) {
    let ip = req.headers['cf-connecting-ip'] ||
             req.headers['x-real-ip'] ||
             (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
             req.socket?.remoteAddress ||
             req.ip ||
             '127.0.0.1';

    // Normalize IPv6 prefix
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }
    if (ip === '::1') {
        ip = '127.0.0.1';
    }
    return ip;
}

const REGION_NAMES_ES = {
    'MD': 'Madrid',
    'CT': 'Barcelona / Cataluña',
    'VC': 'Valencia',
    'AN': 'Sevilla / Andalucía',
    'GA': 'A Coruña / Galicia',
    'PV': 'Bilbao / País Vasco',
    'CL': 'Castilla y León',
    'CM': 'Castilla-La Mancha',
    'AR': 'Zaragoza / Aragón',
    'AS': 'Asturias',
    'CB': 'Santander / Cantabria',
    'IB': 'Palma / Baleares',
    'CN': 'Canarias',
    'MC': 'Murcia',
    'NC': 'Navarra',
    'RI': 'La Rioja',
    'EX': 'Extremadura'
};

function isPrivateIp(ip) {
    if (!ip) return true;
    if (ip === '127.0.0.1' || ip === 'localhost') return true;
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    if (ip.startsWith('172.')) {
        const parts = ip.split('.');
        const sec = parseInt(parts[1], 10);
        if (sec >= 16 && sec <= 31) return true;
    }
    return false;
}

function getGeoInfo(req) {
    const ip = getClientIp(req);
    const cfCountry = req.headers['cf-ipcountry'];

    let countryCode = (cfCountry && cfCountry !== 'XX') ? cfCountry.toUpperCase() : null;
    let city = null;
    let region = null;
    let latitude = null;
    let longitude = null;

    if (!isPrivateIp(ip)) {
        const geo = geoip.lookup(ip);
        if (geo) {
            countryCode = countryCode || geo.country;
            region = geo.region || null;
            city = geo.city || (countryCode === 'ES' && region ? REGION_NAMES_ES[region] : null);
            if (geo.ll && Array.isArray(geo.ll) && geo.ll.length === 2) {
                latitude = geo.ll[0];
                longitude = geo.ll[1];
            }
        }
    } else {
        // Local testing fallback
        countryCode = countryCode || 'ES';
        city = 'Madrid (Local)';
        latitude = 40.4168;
        longitude = -3.7038;
    }

    const countryName = getCountryName(countryCode);
    const flag = getCountryFlag(countryCode);

    // Anonymize IP for privacy (GDPR friendly: mask last octet)
    let maskedIp = ip;
    if (ip.includes('.')) {
        const parts = ip.split('.');
        if (parts.length === 4) {
            maskedIp = `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
        }
    } else if (ip.includes(':')) {
        const parts = ip.split(':');
        maskedIp = parts.slice(0, 3).join(':') + ':xxxx';
    }

    return {
        ip: maskedIp,
        rawIp: ip,
        countryCode: countryCode || 'XX',
        countryName: countryName,
        flag: flag,
        city: city || 'Desconocida',
        region: region || '',
        latitude: latitude,
        longitude: longitude
    };
}

function parseUserAgent(userAgentString) {
    const raw = userAgentString || '';
    const parser = new UAParser(raw);
    const result = parser.getResult();

    let osName = result.os.name;
    // Explicit priority check for mobile OS to guarantee Android & iOS detection
    if (/Android/i.test(raw)) {
        osName = 'Android';
    } else if (/iPhone|iPad|iPod/i.test(raw)) {
        osName = 'iOS';
    } else if (!osName || osName === 'Desconocido') {
        if (/Windows/i.test(raw)) osName = 'Windows';
        else if (/Macintosh|Mac OS/i.test(raw)) osName = 'macOS';
        else if (/Linux/i.test(raw)) osName = 'Linux';
        else osName = 'Otro';
    }

    let deviceType = result.device.type;
    if (!deviceType) {
        if (/Mobile|Android.*Mobile|iPhone|iPod/i.test(raw)) deviceType = 'mobile';
        else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(raw)) deviceType = 'tablet';
        else deviceType = 'desktop';
    }
    if (deviceType !== 'mobile' && deviceType !== 'tablet') {
        deviceType = 'desktop';
    }

    return {
        deviceType: deviceType,
        browserName: result.browser.name || 'Chrome',
        browserVersion: result.browser.major || '',
        osName: osName || 'Desconocido',
        osVersion: result.os.version || ''
    };
}

module.exports = {
    getClientIp,
    getGeoInfo,
    parseUserAgent,
    getCountryFlag,
    getCountryName
};
