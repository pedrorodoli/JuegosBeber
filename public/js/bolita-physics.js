/*
 * Física de La Bolita (clon).
 * El MISMO archivo lo usan el servidor (require) y el navegador (window.BolitaPhysics),
 * así la bola que se ve caer y el premio que da el servidor nunca pueden discrepar.
 *
 * Mejoras respecto a la versión original:
 *  - 4 subpasos por fotograma: la bola ya no atraviesa clavos ni se "engancha" en ellos.
 *  - Ruido determinista con enteros (idéntico en cualquier navegador; Math.sin podía variar).
 *  - Gravedad algo mayor y rebotes más secos: cae con más peso y menos "flotando".
 *  - Los bumpers dan un empujón fijo en vez de multiplicar la velocidad (antes podían dispararla).
 *  - Velocidad máxima, rozamiento leve y la bola rebota y se asienta en el fondo de la casilla.
 *  - Una bola parada encima de un clavo recibe un pequeño empujón lateral.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BolitaPhysics = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const W = 600;
    const START_Y = 80;
    const SLOT_TOP = 680;      // donde empiezan las separaciones de las casillas
    const FLOOR = 800;         // fondo del tablero
    const BALL_R = 12;
    const DIVIDERS = [100, 200, 300, 400, 500];
    const SUBSTEPS = 4;
    const DT = 1 / 60 / SUBSTEPS;
    const G = 980;             // gravedad (px/s²)
    const PEG_REST = 0.5;      // rebote en clavos
    const WALL_REST = 0.55;
    const FLOOR_REST = 0.32;
    const BUMPER_KICK = 380;   // velocidad de salida mínima al tocar un bumper
    const MAX_SPEED = 1050;
    const AIR = 0.9998;        // rozamiento del aire por subpaso
    const MAX_FRAMES = 1500;

    // Hash entero -> [-0.5, 0.5). Determinista en cualquier motor JS.
    function noise(x, y, salt) {
        let h = Math.imul((Math.round(x * 10) | 0) ^ 0x27d4eb2d, 0x85ebca6b);
        h ^= Math.imul((Math.round(y * 10) | 0) + (salt | 0) * 0x165667b1, 0xc2b2ae35);
        h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
        h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
        h ^= h >>> 15;
        return (h >>> 0) / 4294967296 - 0.5;
    }

    function clampSpeed(b) {
        const s2 = b.vx * b.vx + b.vy * b.vy;
        if (s2 > MAX_SPEED * MAX_SPEED) {
            const k = MAX_SPEED / Math.sqrt(s2);
            b.vx *= k; b.vy *= k;
        }
    }

    function collidePeg(b, peg, hits) {
        const dx = b.x - peg.x;
        const dy = b.y - peg.y;
        const minDist = b.r + peg.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minDist * minDist || d2 === 0) return;
        const dist = Math.sqrt(d2);
        const nx = dx / dist, ny = dy / dist;
        // separar
        const overlap = minDist - dist;
        b.x += nx * overlap; b.y += ny * overlap;
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) return;
        const n = noise(peg.x, peg.y, hits.count);
        hits.count++;
        if (peg.isBumper) {
            // empujón fijo hacia fuera + el rebote normal
            const out = Math.max(-vn * 0.9, BUMPER_KICK);
            b.vx += (out - vn) * nx;
            b.vy += (out - vn) * ny;
        } else {
            const j = -(1 + PEG_REST) * vn;
            b.vx += j * nx; b.vy += j * ny;
            // rozamiento tangencial leve
            const tx = -ny, ty = nx;
            const vt = b.vx * tx + b.vy * ty;
            b.vx -= vt * 0.04 * tx; b.vy -= vt * 0.04 * ty;
        }
        b.vx += n * 46;
        // bola casi parada encima del clavo: que caiga hacia un lado
        if (ny < -0.9 && Math.abs(b.vx) < 25) b.vx += (n >= 0 ? 1 : -1) * 55;
        clampSpeed(b);
    }

    function simulateBallDrop(startX, pegs) {
        const b = { x: Number(startX) || W / 2, y: START_Y, vx: 0, vy: 90, r: BALL_R };
        const hits = { count: 0 };
        const path = [{ x: Math.round(b.x * 10) / 10, y: START_Y }];
        let settledFrames = 0;
        let frame = 0;
        let anchorX = b.x, anchorY = b.y, kicks = 0;

        while (frame < MAX_FRAMES) {
            for (let s = 0; s < SUBSTEPS; s++) {
                const prevX = b.x;
                b.vy += G * DT;
                b.vx *= AIR; b.vy *= AIR;
                b.x += b.vx * DT;
                b.y += b.vy * DT;

                for (let i = 0; i < pegs.length; i++) collidePeg(b, pegs[i], hits);

                // paredes
                // (siempre devuelven la bola hacia dentro para que no se quede encajada entre pared y clavo)
                if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.max(Math.abs(b.vx) * WALL_REST, 70); }
                else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.max(Math.abs(b.vx) * WALL_REST, 70); }

                // separadores verticales de las casillas
                if (b.y > SLOT_TOP) {
                    for (let k = 0; k < DIVIDERS.length; k++) {
                        const dx = DIVIDERS[k];
                        if (b.x - b.r < dx && b.x + b.r > dx) {
                            if (prevX < dx) { b.x = dx - b.r; b.vx = -Math.abs(b.vx) * WALL_REST; }
                            else { b.x = dx + b.r; b.vx = Math.abs(b.vx) * WALL_REST; }
                        }
                    }
                }

                // fondo
                if (b.y + b.r > FLOOR) {
                    b.y = FLOOR - b.r;
                    b.vy = -Math.abs(b.vy) * FLOOR_REST;
                    b.vx *= 0.8;
                }
            }
            path.push({ x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10 });
            frame++;

            const onFloor = b.y >= FLOOR - b.r - 0.5;
            if (onFloor && Math.abs(b.vy) < 40 && Math.abs(b.vx) < 30) settledFrames++;
            else settledFrames = 0;
            if (settledFrames > 6) break;

            // atasco: si en medio segundo apenas se ha movido (y no está ya en su casilla), empujón
            if (frame % 30 === 0) {
                const moved = Math.abs(b.x - anchorX) + Math.abs(b.y - anchorY);
                if (moved < 8 && b.y < SLOT_TOP) {
                    const n = noise(b.x, b.y, 977 + kicks++);
                    b.vx += (n >= 0 ? 1 : -1) * (160 + Math.abs(n) * 200);
                    b.vy = -140;
                }
                anchorX = b.x; anchorY = b.y;
            }
        }

        let finalHole = Math.floor(b.x / 100);
        if (finalHole < 0) finalHole = 0;
        if (finalHole > 5) finalHole = 5;
        return { path, finalHole };
    }

    return { simulateBallDrop, W, START_Y, SLOT_TOP, FLOOR, BALL_R, DIVIDERS };
});
