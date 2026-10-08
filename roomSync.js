// Utilidades para que las partidas aguanten varios jugadores a la vez sin pisarse
// y sin que nadie pueda hacerse pasar por otro.
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 1. Cola por sala
// Cada acción lee la partida de MySQL, la cambia y la guarda. Si dos acciones
// de la misma sala se ejecutan a la vez, la segunda en guardar borra lo que hizo
// la primera (votos perdidos, jugadores que no aparecen...). Con esta cola las
// acciones de una misma sala se procesan de una en una, en orden de llegada.
// Las salas distintas siguen yendo en paralelo.
// OJO: no se puede llamar a withRoomLock desde dentro de otra tarea de la misma
// sala (se quedaría esperando a sí misma). Solo se usa en los puntos de entrada:
// eventos de socket y temporizadores.
// ---------------------------------------------------------------------------
const roomQueues = new Map();

function withRoomLock(roomId, fn) {
    const key = String(roomId);
    const prev = roomQueues.get(key) || Promise.resolve();
    const run = prev.then(() => fn());
    const tail = run.catch((err) => {
        console.error(`[Server] Error en la sala ${key}:`, err && err.stack || err);
    });
    roomQueues.set(key, tail);
    tail.then(() => { if (roomQueues.get(key) === tail) roomQueues.delete(key); });
    return tail;
}

// Temporizador que se ejecuta dentro de la cola de la sala
function roomTimeout(roomId, fn, ms) {
    return setTimeout(() => withRoomLock(roomId, fn), ms);
}
function roomInterval(roomId, fn, ms) {
    return setInterval(() => withRoomLock(roomId, fn), ms);
}

// ---------------------------------------------------------------------------
// 2. Identificadores públicos
// El uuid de cada jugador funciona como su "llave": quien lo sabe puede entrar
// como él (y el del creador da permisos de anfitrión). Antes se enviaba a todos.
// Ahora cada jugador recibe su propio uuid real, y los de los demás sustituidos
// por un alias que no sirve para suplantarles.
// ---------------------------------------------------------------------------
const ALIAS_KEY = crypto.randomBytes(32);
const ALIAS_PREFIX = 'p_';
const roomUuids = new Map(); // roomId -> Set de uuids reales vistos en la sala

function aliasOf(uuid) {
    return ALIAS_PREFIX + crypto.createHmac('sha256', ALIAS_KEY).update(String(uuid)).digest('hex').slice(0, 16);
}

function isValidUuid(uuid) {
    return typeof uuid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(uuid);
}

function registerUuid(roomId, uuid) {
    if (!isValidUuid(uuid)) return;
    let set = roomUuids.get(roomId);
    if (!set) roomUuids.set(roomId, set = new Set());
    set.add(uuid);
}

function forgetRoom(roomId) {
    roomUuids.delete(roomId);
}

// Convierte lo que manda un cliente (alias de otro jugador, o su propio uuid) en el uuid real
function resolveUuid(roomId, id) {
    if (typeof id !== 'string') return null;
    const set = roomUuids.get(roomId);
    if (!set) return null;
    if (id.startsWith(ALIAS_PREFIX)) {
        for (const real of set) if (aliasOf(real) === id) return real;
        return null;
    }
    return set.has(id) ? id : null;
}

// Copia el contenido cambiando los uuids reales de otros por su alias
function maskUuids(value, roomId, keepUuid) {
    const set = roomUuids.get(roomId);
    if (!set || set.size === 0) return value;
    const map = (s) => (s !== keepUuid && set.has(s)) ? aliasOf(s) : s;
    const walk = (v) => {
        if (typeof v === 'string') return map(v);
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v)) out[map(k)] = walk(v[k]);
            return out;
        }
        return v;
    };
    return walk(value);
}

module.exports = {
    withRoomLock,
    roomTimeout,
    roomInterval,
    aliasOf,
    isValidUuid,
    registerUuid,
    forgetRoom,
    resolveUuid,
    maskUuids,
};
