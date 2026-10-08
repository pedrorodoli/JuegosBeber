require('dotenv').config({ quiet: true }); // Load environment variables from .env file and suppress logs

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const activeGameIntervals = {}; // To store setInterval IDs for active games
const lamenteTimeouts = {}; // To store setInterval IDs for La Mente game countdowns
const db = require('./db'); // Import the database module
const { simulateBallDrop } = require('./public/js/bolita-physics'); // (clon) física compartida con el navegador
const analyticsDb = require('./analyticsDb');
const geoUtils = require('./geoUtils');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3006;

// Initialize database and then start the server
db.initializeDatabase().then(async () => {
    console.log('[Server] Cleaning up old rooms...');
    await db.deleteAllRooms(); // Delete all rooms on startup
    server.listen(PORT, () => console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`));
}).catch(err => {
    console.error('[Server] Failed to initialize database and start server:', err);
    process.exit(1);
});

// The 'rooms' object will now be replaced by database calls
// const rooms = {};

// --- Lógica de Juegos ---

function createDeck() {
    const suits = ['Oros', 'Copas', 'Espadas', 'Bastos'];
    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return suits.flatMap(suit => numbers.map(number => ({ suit, number })));
}

function createPokerDeck() {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    return suits.flatMap(suit => ranks.map(rank => ({ suit, rank })));
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function createLamenteState(settings) {
    return {
        game: 'lamente',
        phase: 'waiting', // waiting, countdown, playing, finished
        players: [], // Player data will be stored here { uuid, name, id (socket.id), number }
        settings: {
            min: parseInt(settings.min, 10) || 1,
            max: parseInt(settings.max, 10) || 100,
            countdown: parseInt(settings.countdown, 10) || 5, // Countdown fixed at 5s
        },
        remainingPlayers: [], // List of player UUIDs in current correct order
        lastPlayerOrder: [], // List of player UUIDs in the order they guessed correctly
        // currentTimeout is an in-memory reference, not for persistence.
    };
}

function createImitadorState(settings) {
    return {
        game: 'imitador',
        phase: 'waiting', // waiting, playing
        players: [],
        assignments: {}, // { imitatorUuid: targetUuid }
        settings: settings || {}
    };
}

function createHorseRaceState() {
    return {
        game: 'horse-race',
        phase: 'waiting',
        players: [],
        raceData: {
            positions: { Oros: 0, Copas: 0, Espadas: 0, Bastos: 0 },
            deck: [],
            stepCards: [], // Cartas en los escalones de la pista
            lastCard: null
        },
        winner: null,
        settings: { levels: 5, maxBet: 10, prizeMultiplier: 2 },
        gameInterval: null, // This will be a placeholder, not directly stored in DB
        winnersDistributedDrinks: [], // To track which winners have distributed drinks
        noWinnerBets: false, // Flag if no one bet on the winner
    };
}

function createVotingState(settings) {
    return {
        game: 'voting',
        phase: 'waiting',
        players: [],
        title: settings.name,
        options: settings.options.map(opt => ({ name: opt, votes: 0 })),
        votes: {},
        endTime: null,
        settings: settings, // <--- ADDED: Store the entire settings object
    };
}

const ROULETTE_NUMBERS = { 0: 'green', 1: 'red', 2: 'black', 3: 'red', 4: 'black', 5: 'red', 6: 'black', 7: 'red', 8: 'black', 9: 'red', 10: 'black', 11: 'black', 12: 'red', 13: 'black', 14: 'red', 15: 'black', 16: 'red', 17: 'black', 18: 'red', 19: 'red', 20: 'black', 21: 'red', 22: 'black', 23: 'red', 24: 'black', 25: 'red', 26: 'black', 27: 'red', 28: 'black', 29: 'black', 30: 'red', 31: 'black', 32: 'red', 33: 'black', 34: 'red', 35: 'black', 36: 'red' };

function createRouletteState(settings) {
    // Make sure settings is an object
    const safeSettings = settings || {};

    return {
        game: 'roulette',
        phase: 'waiting', // waiting, betting, spinning, results, distributing
        players: [],
        bets: {}, // { "player_uuid": [{type: 'number', value: 10, amount: 5}, ...] }
        winningNumber: null,
        timer: null,
        winners: [], // Players who won in this round
        drinkDistributionTimer: null,
        settings: {
            initialSips: safeSettings.initialSips || 100,
            bettingTime: safeSettings.bettingTime || 30, // seconds
            drinkPrice: safeSettings.drinkPrice || 20, // points per drink
            zeroSipsPenalty: safeSettings.zeroSipsPenalty || 5, // drinks
            resultTime: 5, // seconds to show results
            distributionTime: 20, // seconds to distribute drinks
        },
    };
}

function createPyramidState(settings) {
    const pyramidCardsNeeded = settings.levels * (settings.levels + 1) / 2;
    const maxPlayersForLevels = Math.floor((48 - pyramidCardsNeeded) / 2); // 48 cards in deck, 2 per player

    return {
        game: 'pyramid',
        phase: 'waiting',
        players: [],
        pyramid: [],
        playerHands: {}, // { "player_uuid": [card1, card2] }
        revealedPyramidCards: [],
        currentCardIndex: 0,
        actionLog: [],
        settings: {
            levels: settings.levels || 4,
            maxPlayers: maxPlayersForLevels > 0 ? maxPlayersForLevels : 1 // Ensure at least 1 player
        },
    };
}

function createAutobusState() {
    return {
        game: 'autobus',
        phase: 'waiting',
        players: [],
        deck: shuffleDeck(createPokerDeck()), // Use poker deck
        currentCard: null,
        settings: {},
        currentPlayerIndex: 0,
    };
}

function createCofresState(settings) {
    let numChests = parseInt(settings?.numChests, 10) || 20;
    if (numChests < 10) numChests = 10;
    if (numChests > 30) numChests = 30;

    return {
        game: 'cofres',
        phase: 'waiting',
        players: [],
        turnOrder: [],
        currentPlayerIndex: 0,
        chests: [],
        lastAction: null,
        settings: {
            numChests: numChests
        }
    };
}

function createBolitaState(settings) {
    const numBumpers = parseInt(settings?.numBumpers, 10) || 4;
    const state = {
        game: 'bolita',
        phase: 'waiting',
        players: [],
        turnOrder: [],
        currentPlayerIndex: 0,
        pegs: [],
        prizes: [],
        ballState: {
            dropping: false,
            path: null,
            startX: null,
            finalHole: null,
            reward: null
        },
        lastAction: null,
        settings: {
            numBumpers: numBumpers
        }
    };
    return state;
}

function regenerateBolitaRound(gameState) {
    const numBumpers = gameState.settings.numBumpers || 4;

    // Generate prizes array (6 items)
    const prizePool = [
        { type: 'BEBE', value: 1, text: 'Bebes 1 trago' },
        { type: 'BEBE', value: 2, text: 'Bebes 2 tragos' },
        { type: 'BEBE', value: 3, text: 'Bebes 3 tragos' },
        { type: 'REPARTE', value: 1, text: 'Repartes 1 trago' },
        { type: 'REPARTE', value: 2, text: 'Repartes 2 tragos' },
        { type: 'REPARTE', value: 3, text: 'Repartes 3 tragos' },
        { type: 'TODOS', value: 1, text: '¡Beben todos!' },
        { type: 'CHUPITO', value: 1, text: '¡Toma un chupito!' },
        { type: 'MANDA_CHUPITO', value: 1, text: '¡Manda un chupito!' },
        { type: 'SALVADO', value: 0, text: '¡Te salvas!' }
    ];

    // Pick 6 random prizes
    const prizes = [];
    for (let i = 0; i < 6; i++) {
        prizes.push(prizePool[Math.floor(Math.random() * prizePool.length)]);
    }

    // Generate random pegs using dart-throwing (Poisson-disk-like) for organic distribution
    const pegs = [];
    const minDistance = 56;
    const maxPegs = 48;
    let attempts = 0;

    while (pegs.length < maxPegs && attempts < 2000) {
        // Range: X inside [30, 570], Y inside [160, 630]
        const px = Math.random() * 540 + 30;
        const py = Math.random() * 470 + 160;

        let tooClose = false;
        for (const peg of pegs) {
            const dx = px - peg.x;
            const dy = py - peg.y;
            if (dx * dx + dy * dy < minDistance * minDistance) {
                tooClose = true;
                break;
            }
        }

        if (!tooClose) {
            pegs.push({
                id: `rand-peg-${pegs.length}`,
                x: Math.round(px * 10) / 10,
                y: Math.round(py * 10) / 10,
                r: 8,
                isBumper: false
            });
        }
        attempts++;
    }

    // Place bumpers by converting random pegs
    let bumpersPlaced = 0;
    let bumperAttempts = 0;
    while (bumpersPlaced < numBumpers && bumperAttempts < 100) {
        const idx = Math.floor(Math.random() * pegs.length);
        if (pegs[idx] && !pegs[idx].isBumper) {
            pegs[idx].isBumper = true;
            pegs[idx].r = 18; // larger radius
            bumpersPlaced++;
        }
        bumperAttempts++;
    }

    // Add static divider pegs at Y = 680 to let the ball bounce off slot dividers
    const dividers = [100, 200, 300, 400, 500];
    for (let i = 0; i < dividers.length; i++) {
        pegs.push({
            id: `div-peg-${i}`,
            x: dividers[i],
            y: 680,
            r: 7,
            isBumper: false,
            isDividerPeg: true
        });
    }

    gameState.pegs = pegs;
    gameState.prizes = prizes;
    gameState.ballState = {
        dropping: false,
        path: null,
        startX: null,
        finalHole: null,
        reward: null
    };
}





function getSanitizedGameState(gameState) {
    const stateToSend = { ...gameState };
    stateToSend.serverNow = Date.now(); // (clon) para que los relojes del cliente se sincronicen
    // currentTimeout is not for persistence, so ensure it's removed if somehow present.
    if (stateToSend.currentTimeout) {
        delete stateToSend.currentTimeout;
    }
    return stateToSend;
}

async function advanceRaceStep(roomId, gameType) {
    const room = await db.getRoomById(roomId);
    if (!room) return; // Room might have been deleted
    let gameState = await db.getGameState(roomId);
    if (!gameState || gameState.phase !== 'race') return;

    const { raceData, settings } = gameState;
    if (raceData.deck.length === 0) {
        await endRace(roomId, gameType, null);
        return;
    }

    // 1. Saca una carta para avanzar un caballo
    const drawnCard = raceData.deck.pop();
    raceData.lastCard = drawnCard;
    raceData.positions[drawnCard.suit]++;

    // 2. Comprueba si se debe revelar alguna carta de escalón
    for (let i = 0; i < raceData.stepCards.length; i++) {
        const step = i + 1; // Los escalones son 1, 2, 3, 4
        const stepCard = raceData.stepCards[i];

        // Si la carta no ha sido revelada y todos los caballos han superado el escalón
        if (!stepCard.revealed && Object.values(raceData.positions).every(pos => pos >= step)) {
            stepCard.revealed = true;
            const penaltyCard = stepCard.card;
            
            // Aplica la penalización: el caballo del palo de la carta retrocede
            if (raceData.positions[penaltyCard.suit] > 0) {
                raceData.positions[penaltyCard.suit]--;
            }
        }
    }

    // 3. Comprueba si hay un ganador
    if (raceData.positions[drawnCard.suit] >= settings.levels) {
        // Clear interval immediately to stop the race
        if (activeGameIntervals[roomId]) {
            clearInterval(activeGameIntervals[roomId]);
            delete activeGameIntervals[roomId];
        }

        // Persist and notify clients about the final position BEFORE ending the race
        // This allows clients to see the horse cross the finish line
        await db.updateGameState(roomId, gameState);
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));

        // Wait 3 seconds before transitioning to the results/distribution phase
        setTimeout(async () => {
            await endRace(roomId, gameType, drawnCard.suit);
        }, 3000);
    } else {
        // Continue race: persist state and notify clients
        await db.updateGameState(roomId, gameState);
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    }
}

async function startRace(roomId, gameType) {
    const room = await db.getRoomById(roomId);
    if (!room) return;
    let gameState = await db.getGameState(roomId);
    if (!gameState) return;

    console.log(`[Server] Iniciando carrera en la sala ${roomId}`);
    gameState.phase = 'race';

    // 1. Crear y barajar un mazo completo
    const fullDeck = shuffleDeck(createDeck());

    // 2. Determinar el número de cartas de escalón (niveles - 1)
    const numStepCards = gameState.settings.levels - 1;

    // 3. Sacar las cartas para los escalones del mazo principal
    const stepCardData = fullDeck.slice(0, numStepCards);
    gameState.raceData.stepCards = stepCardData.map(card => ({ card: card, revealed: false }));

    // 4. El resto del mazo se usa para avanzar
    gameState.raceData.deck = fullDeck.slice(numStepCards);
    
    // Clear existing interval if any
    if (activeGameIntervals[roomId]) {
        clearInterval(activeGameIntervals[roomId]);
    }
    
    // Store interval ID in a temporary in-memory map, not in DB
    activeGameIntervals[roomId] = setInterval(() => advanceRaceStep(roomId, gameType), 2000);
    
    await db.updateGameState(roomId, gameState); // Persist updated state
    io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
}

async function endRace(roomId, gameType, winnerSuit) {
    const room = await db.getRoomById(roomId);
    if (!room) return;
    let gameState = await db.getGameState(roomId);
    if (!gameState || gameState.phase !== 'race') return;

    console.log(`[Server] Carrera finalizada en ${roomId}. Ganador: ${winnerSuit}`);
    
    // Clear interval using the global map
    if (activeGameIntervals[roomId]) {
        clearInterval(activeGameIntervals[roomId]);
        delete activeGameIntervals[roomId];
    }

    gameState.winner = winnerSuit;

    const winners = gameState.players.filter(p => p.betOn === winnerSuit && p.betAmount > 0);
    if (winnerSuit && winners.length > 0) {
        gameState.phase = 'distributing';
        gameState.winners = winners.map(w => ({
            uuid: w.uuid,
            name: w.name,
            sipsWon: w.betAmount * gameState.settings.prizeMultiplier
        }));
        gameState.winnersDistributedDrinks = [];
        gameState.noWinnerBets = false;
    } else {
        gameState.phase = 'finished';
        if (!winnerSuit || winners.length === 0) {
            gameState.noWinnerBets = true;
        }
    }

    await db.updateGameState(roomId, gameState); // Persist updated state
    const stateToSend = getSanitizedGameState(gameState);
    stateToSend.roomAdminId = room.creatorId; // This was originally here
    io.to(roomId).emit('roomState', stateToSend);
}

function calculateWinnings(gameState) {
    try {
        const { winningNumber, bets, players } = gameState;
        gameState.winners = []; // Reset winners list

        for (const playerUuid in bets) {
            const player = players.find(p => p.uuid === playerUuid);
            if (!player) continue;

            let roundPayout = 0;
            let wonBets = [];

            bets[playerUuid].forEach(bet => {
                let won = false;
                let payoutMultiplier = 0;

                switch (bet.type) {
                    case 'number':
                        if (bet.value == winningNumber) { won = true; payoutMultiplier = 35; }
                        break;
                    case 'color':
                        if (winningNumber != 0 && ROULETTE_NUMBERS[winningNumber] === bet.value) { won = true; payoutMultiplier = 1; }
                        break;
                    case 'even':
                        if (winningNumber != 0 && winningNumber % 2 === 0) { won = true; payoutMultiplier = 1; }
                        break;
                    case 'odd':
                        if (winningNumber != 0 && winningNumber % 2 !== 0) { won = true; payoutMultiplier = 1; }
                        break;
                    case 'dozen':
                        const [start, end] = bet.value.split('-').map(Number);
                        if (winningNumber >= start && winningNumber <= end) { won = true; payoutMultiplier = 2; }
                        break;
                    case 'low':
                        if (winningNumber >= 1 && winningNumber <= 18) { won = true; payoutMultiplier = 1; }
                        break;
                    case 'high':
                        if (winningNumber >= 19 && winningNumber <= 36) { won = true; payoutMultiplier = 1; }
                        break;
                }

                if (won) {
                    const winAmount = bet.amount * payoutMultiplier + bet.amount;
                    roundPayout += winAmount;
                    wonBets.push({ ...bet, payout: winAmount });
                }
            });

            if (roundPayout > 0) {
                player.sips += roundPayout;
                player.wonThisRound = roundPayout;
                gameState.winners.push({
                    uuid: player.uuid,
                    name: player.name,
                    winAmount: roundPayout,
                    bets: wonBets
                });
            }
        }
    } catch (error) {
        console.error("[Server] !!! CRITICAL ERROR in calculateWinnings !!!");
        console.error(error);
    }
}

async function startRouletteBetting(roomId) {
    const room = await db.getRoomById(roomId);
    if (!room) return;
    let gameState = await db.getGameState(roomId);
    if (!gameState) return;

    // --- NEW ZERO-POINTS LOGIC ---
    gameState.players.forEach(player => {
        if (player.isSittingOut) {
            // Player was sitting out, replenish their points and let them play
            player.sips = gameState.settings.initialSips;
            player.isSittingOut = false;
            // Penalty is now implicitly communicated by the client seeing the penaltyDrinks property
        } else if (player.sips <= 0) {
            // Player just ran out of points, make them sit out this round
            player.isSittingOut = true;
            player.penaltyDrinks = gameState.settings.zeroSipsPenalty; // Set penalty drinks
            player.sips = 0; // Ensure sips don't go negative
        }
    });

    // Reset distribution flag for all players
    gameState.players.forEach(player => {
        player.hasDistributed = false;
    });
    // --- END OF NEW LOGIC ---

    gameState.phase = 'betting';
    gameState.bets = {};
    gameState.winningNumber = null;
    gameState.timer = gameState.settings.bettingTime;
    gameState.bettingEndsAt = Date.now() + gameState.settings.bettingTime * 1000; // (clon) el reloj cuenta hasta aquí

    if (activeGameIntervals[roomId]) clearInterval(activeGameIntervals[roomId]);

    activeGameIntervals[roomId] = setTimeout(async () => {
        await startRouletteSpin(roomId);
    }, gameState.settings.bettingTime * 1000);

    await db.updateGameState(roomId, gameState);
    io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
}

async function startRouletteSpin(roomId) {
    const room = await db.getRoomById(roomId);
    if (!room) return;
    let gameState = await db.getGameState(roomId);
    if (!gameState) return;

    console.log(`[Server] Iniciando Ruleta en la sala ${roomId}`);
    gameState.phase = 'spinning';
    gameState.winningNumber = Math.floor(Math.random() * 37); // 0-36

    await db.updateGameState(roomId, gameState);
    io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    
    setTimeout(async () => {
        await endRouletteRound(roomId);
    }, 6000); // 6s for spin animation + result display
}

async function endRouletteRound(roomId) {
    const room = await db.getRoomById(roomId);
    if (!room) return;
    let gameState = await db.getGameState(roomId);
    if (!gameState) return;

    console.log(`[Server] Terminando Ruleta en la sala ${roomId}`);
    gameState.phase = 'results';
    calculateWinnings(gameState);

    await db.updateGameState(roomId, gameState);
    io.to(roomId).emit('roomState', getSanitizedGameState(gameState));

    // Wait for results display, then check if we need distribution phase
    setTimeout(async () => {
        const currentState = await db.getGameState(roomId);
        if (!currentState) return;

        // Check if any winner can distribute drinks
        const hasDistributableWinners = currentState.winners.some(w => {
            const player = currentState.players.find(p => p.uuid === w.uuid);
            return player && player.sips >= currentState.settings.drinkPrice;
        });

        if (hasDistributableWinners) {
            // Start distribution phase
            currentState.phase = 'distributing';
            currentState.drinkDistributionTimer = currentState.settings.distributionTime;
            
            await db.updateGameState(roomId, currentState);
            io.to(roomId).emit('roomState', getSanitizedGameState(currentState));

            // Set timeout for distribution phase
            setTimeout(async () => {
                await startRouletteBetting(roomId);
            }, currentState.settings.distributionTime * 1000);
        } else {
            // No distribution needed, start new round
            await startRouletteBetting(roomId);
        }
    }, gameState.settings.resultTime * 1000); // (clon) antes usaba currentState fuera de su ámbito y tumbaba el servidor
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Analytics & Real-time Dashboard ---
const STATS_PASSWORD = process.env.STATS_PASSWORD || 'juegosbeber';

// (clon) La cookie ya no guarda la clave en Base64 (se podía leer tal cual): guarda un hash.
const STATS_TOKEN = require('crypto').createHash('sha256').update('jb-stats:' + STATS_PASSWORD).digest('hex');
function hasStatsCookie(cookieHeader) {
    return (cookieHeader || '').split(';').some(c => c.trim() === `jb_stats_auth=${STATS_TOKEN}`);
}
function isDashboardAuthorized(req) {
    if (!STATS_PASSWORD) return true;
    if (hasStatsCookie(req.headers.cookie)) return true;
    if (req.query.key && req.query.key === STATS_PASSWORD) return true;
    return false;
}

// (clon) Salas activas en este momento, para /stats
async function getLiveRooms() {
    const rooms = await db.getAllRooms();
    const byGame = {};
    const list = [];
    let totalPlayers = 0;
    for (const room of rooms) {
        const connected = (io.sockets.adapter.rooms.get(room.id) || { size: 0 }).size;
        let phase = null, players = 0;
        try { const gs = await db.getGameState(room.id); if (gs) { phase = gs.phase || null; players = Array.isArray(gs.players) ? gs.players.length : 0; } } catch (e) {}
        totalPlayers += connected;
        const g = byGame[room.gameType] || (byGame[room.gameType] = { gameType: room.gameType, rooms: 0, players: 0 });
        g.rooms++; g.players += connected;
        list.push({ id: room.id, name: room.name, gameType: room.gameType, isPublic: !!room.isPublic, hasPassword: room.hasPassword, connected, players, phase });
    }
    list.sort((a, b) => b.connected - a.connected);
    return { totalRooms: rooms.length, totalPlayers, byGame: Object.values(byGame).sort((a, b) => b.players - a.players || b.rooms - a.rooms), rooms: list.slice(0, 30) };
}

// Redirección de /dashboard a /stats
app.get('/dashboard', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, '/stats' + qs);
});

// Ruta principal de estadísticas (/stats)
app.get('/stats', (req, res) => {
    if (req.query.key && req.query.key === STATS_PASSWORD) {
        const token = STATS_TOKEN;
        res.setHeader('Set-Cookie', `jb_stats_auth=${token}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
    }
    res.render('stats', {
        title: 'Estadísticas en Tiempo Real - JuegosBeber.es'
    });
});

// Autenticación para el Dashboard
app.post('/api/analytics/auth', (req, res) => {
    const { key } = req.body;
    if (key === STATS_PASSWORD) {
        const token = STATS_TOKEN;
        res.setHeader('Set-Cookie', `jb_stats_auth=${token}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`);
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, message: 'Clave incorrecta' });
});

// Datos para Estadísticas (/stats y /dashboard)
app.get(['/api/analytics/stats-data', '/api/analytics/dashboard-data'], async (req, res) => {
    try {
        if (!isDashboardAuthorized(req)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const range = req.query.range || 'today';
        const os = req.query.os || null;
        const data = await analyticsDb.getDashboardData(db.pool, range, os);
        try { data.liveRooms = await getLiveRooms(); } catch (e) { data.liveRooms = null; }
        res.json(data);
    } catch (err) {
        console.error('[Analytics] Error obteniendo datos de estadísticas:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Resetear todas las estadísticas
app.post('/api/analytics/reset-stats', async (req, res) => {
    try {
        if (!isDashboardAuthorized(req)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        await analyticsDb.resetAnalytics(db.pool);
        io.to('analytics_dashboard').emit('analytics:reset');
        res.json({ success: true, message: 'Todas las estadísticas han sido reseteadas.' });
    } catch (err) {
        console.error('[Analytics] Error reseteando estadísticas:', err);
        res.status(500).json({ error: 'Error reseteando estadísticas' });
    }
});

// Registrar visita (Pageview)
app.post('/api/analytics/pageview', async (req, res) => {
    try {
        const { visitorId, sessionId, path: visitPath, title, referrer, screenRes, language } = req.body;
        if (!visitorId || !sessionId) {
            return res.status(400).json({ error: 'Missing identifiers' });
        }

        const geo = geoUtils.getGeoInfo(req);
        const ua = geoUtils.parseUserAgent(req.headers['user-agent']);

        await analyticsDb.recordVisit(db.pool, {
            visitorId,
            sessionId,
            path: visitPath || '/',
            title,
            referrer,
            geo,
            ua,
            screenRes,
            language
        });

        // Notificar en tiempo real al Dashboard
        const active = await analyticsDb.getActiveUsers(db.pool);
        io.to('analytics_dashboard').emit('analytics:new_visit', {
            path: visitPath || '/',
            title: title || '',
            countryCode: geo.countryCode,
            countryName: geo.countryName,
            flag: geo.flag,
            city: geo.city,
            deviceType: ua.deviceType,
            browserName: ua.browserName,
            activeCount: active.count
        });

        res.json({ success: true });
    } catch (err) {
        console.error('[Analytics] Error en /api/analytics/pageview:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Heartbeat de presencia activa
app.post('/api/analytics/heartbeat', async (req, res) => {
    try {
        const { sessionId, path: currentPath, title } = req.body;
        if (sessionId) {
            await analyticsDb.recordHeartbeat(db.pool, sessionId, currentPath, title);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Finalizar sesión activa (desconexión inmediata al salir de la página)
app.post('/api/analytics/session-end', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (sessionId) {
            await analyticsDb.endSession(db.pool, sessionId);
            const active = await analyticsDb.getActiveUsers(db.pool);
            io.to('analytics_dashboard').emit('analytics:active_count', active.count);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/sitemap.xml', (req, res) => {
    const baseUrl = 'https://juegosbeber.es';
    const gameTypes = ['horse-race', 'voting', 'roulette', 'pyramid', 'autobus', 'lamente', 'imitador', 'cofres', 'bolita'];
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    
    // Static pages
    xml += `<url><loc>${baseUrl}/</loc><priority>1.0</priority><changefreq>weekly</changefreq></url>`;
    xml += `<url><loc>${baseUrl}/privacy</loc><priority>0.5</priority><changefreq>yearly</changefreq></url>`;
    xml += `<url><loc>${baseUrl}/terms</loc><priority>0.5</priority><changefreq>yearly</changefreq></url>`;
    xml += `<url><loc>${baseUrl}/contact</loc><priority>0.5</priority><changefreq>yearly</changefreq></url>`;
    // Game room listing pages
    gameTypes.forEach(type => {
        xml += `<url><loc>${baseUrl}/rooms/${type}</loc><priority>0.8</priority><changefreq>daily</changefreq></url>`;
    });
    
    xml += '</urlset>';
    
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

app.get('/', (req, res) => res.render('index', { 
    title: 'Juegos Beber',
    description: 'Descubre JuegosBeber.es, la plataforma líder de juegos beber online gratis. Juega a la Pirámide, el Autobús, Carreras de Caballos y más sin descargar nada. ¡Diversión garantizada para tus fiestas!'
}));

app.get('/privacy', (req, res) => res.render('privacy', {
    title: 'Política de Privacidad - JuegosBeber.es',
    description: 'Consulta nuestra política de privacidad para entender cómo protegemos tus datos y qué información recopilamos en JuegosBeber.es.'
}));

app.get('/terms', (req, res) => res.render('terms', {
    title: 'Términos y Condiciones - JuegosBeber.es',
    description: 'Lee los términos y condiciones de uso de JuegosBeber.es. Juega con responsabilidad y conoce nuestras normas de la comunidad.'
}));

app.get('/contact', (req, res) => res.render('contact', {
    title: 'Contacto - JuegosBeber.es',
    description: 'Contacta con JuegosBeber.es para dudas, sugerencias o incidencias.'
}));

app.get('/rooms/:gameType', async (req, res) => {
    const { gameType } = req.params;

    const gameTypeNames = {
        'horse-race': 'Carrera de Caballos',
        'voting': 'Votaciones',
        'roulette': 'Ruleta',
        'pyramid': 'La Pirámide',
        'autobus': 'El Autobús',
        'lamente': 'La Mente',
        'imitador': 'El Imitador',
        'cofres': 'Cofres del Tesoro',
        'bolita': 'La Bolita'
    };
    
    const gameDescriptions = {
        'horse-race': 'Compite en una emocionante carrera de caballos con cartas. Apuesta tus sorbos y deja que el azar decida quién bebe.',
        'voting': 'Descubre qué piensan tus amigos de ti con el juego de las votaciones. ¿Quién es más probable que...?',
        'roulette': 'Gira la ruleta de la suerte y reparte tragos entre los perdedores. Un clásico de casino adaptado para fiestas.',
        'pyramid': 'El juego de cartas de la Pirámide: memoria y faroleo para hacer beber a tus amigos.',
        'autobus': '¿Podrás bajarte del autobús? Adivina las cartas y evita acumular tragos en este juego de pura tensión.',
        'lamente': 'Un reto cooperativo de sincronización mental. Juega tus cartas en orden sin hablar.',
        'imitador': 'Imita a tus amigos y trata de que no te pillen. El juego de risas y personificación definitivo.',
        'cofres': 'Abre cofres del tesoro y descubre qué castigo te espera. ¡Suerte!',
        'bolita': 'Suelta la bola desde la parte superior y mira cómo rebota por los obstáculos aleatorios hasta llegar a los premios. ¡Sincronizado en tiempo real!'
    };

    const prettyGameName = gameTypeNames[gameType] || gameType;
    const description = gameDescriptions[gameType] || `Juega a ${prettyGameName} online con tus amigos en JuegosBeber.es.`;

    const allRooms = await db.getAllRooms(gameType);
    
    const roomsWithPlayerCount = await Promise.all(allRooms.map(async (room) => {
        const gameState = await db.getGameState(room.id);
        const playerCount = gameState && gameState.players ? gameState.players.length : 0;
        return { ...room, playerCount };
    }));

    res.render('rooms', { 
        title: `${prettyGameName}`, 
        gameType, 
        rooms: roomsWithPlayerCount,
        description: description
    });
});

app.get('/rooms/:gameType/data', async (req, res) => {
    const { gameType } = req.params;
    const allRooms = await db.getAllRooms(gameType);
    
    const roomsWithPlayerCount = await Promise.all(allRooms.map(async (room) => {
        const gameState = await db.getGameState(room.id);
        const playerCount = gameState && gameState.players ? gameState.players.length : 0;
        return { ...room, playerCount };
    }));

    res.json({ rooms: roomsWithPlayerCount });
});

// (clon) Comprobar la contraseña ANTES de entrar en la sala (lista de salas y enlaces de invitación)
app.post('/api/rooms/:roomId/access', async (req, res) => {
    try {
        const room = await db.getRoomById(req.params.roomId);
        if (!room) return res.status(404).json({ exists: false });
        const { password, uuid } = req.body || {};
        const needsPassword = !!room.password && room.creatorId !== uuid;
        const ok = !needsPassword || (typeof password === 'string' && password === room.password);
        res.json({ exists: true, gameType: room.gameType, needsPassword, ok });
    } catch (err) {
        console.error('[Server] Error comprobando acceso:', err.message);
        res.status(500).json({ error: 'No se pudo comprobar la sala.' });
    }
});

app.get('/game/:gameType/:roomId', async (req, res) => {
    const { gameType, roomId } = req.params;
    const room = await db.getRoomById(roomId);
    if (!room || room.gameType !== gameType) return res.status(404).send('La sala no existe o el tipo de juego no coincide.');
    
    let view = '';
    let players = []; // Default to empty array

    if (gameType === 'roulette') {
        view = 'roulette';
        const gameState = await db.getGameState(roomId);
        if (gameState && gameState.players) {
            players = gameState.players;
        }
    } else if (gameType === 'horse-race') {
        view = 'horse-race';
    } else if (gameType === 'voting') {
        view = 'voting';
    } else if (gameType === 'pyramid') {
        view = 'pyramid';
    } else if (gameType === 'autobus') {
        view = 'autobus';
    } else if (gameType === 'lamente') {
        view = 'lamente';
    } else if (gameType === 'imitador') {
        view = 'imitador';
    } else if (gameType === 'cofres') {
        view = 'cofres';
    } else if (gameType === 'bolita') {
        view = 'bolita';
    } else {
        return res.status(404).send('Tipo de juego no encontrado.');
    }
    
    const gameTypeNames = {
        'horse-race': 'Carrera de Caballos',
        'voting': 'Votaciones',
        'roulette': 'Ruleta',
        'pyramid': 'La Pirámide',
        'autobus': 'El Autobús',
        'lamente': 'La Mente',
        'imitador': 'El Imitador',
        'cofres': 'Cofres del Tesoro',
        'bolita': 'La Bolita'
    };
    const prettyGameName = gameTypeNames[gameType] || gameType;
    
    res.render(view, { 
        title: `${prettyGameName}`, 
        gameType, 
        roomId, 
        players: players,
        description: `Disfruta de ${prettyGameName} online con tus amigos. La mejor experiencia de juegos beber en tiempo real.`
    });
});

app.get('/admin/:gameType', (req, res) => {
    const { gameType } = req.params;

    const gameTitles = {
        'horse-race': 'Carrera de Caballos',
        'voting': 'Votaciones',
        'roulette': 'Ruleta',
        'pyramid': 'La Pirámide',
        'autobus': 'El Autobús',
        'lamente': 'La Mente',
        'imitador': 'El Imitador',
        'cofres': 'Cofres del Tesoro',
        'bolita': 'La Bolita'
    };
    
    const gameDescriptions = {
        'horse-race': 'Configura tu propia carrera de caballos y desafía a tus amigos.',
        'voting': 'Crea una votación personalizada y descubre la verdad sobre tus amigos.',
        'roulette': 'Ajusta los puntos y premios de tu ruleta personalizada.',
        'pyramid': 'Elige los niveles de dificultad de tu pirámide de cartas.',
        'autobus': 'Prepara el autobús para tus amigos. ¡Que no se queden arriba!',
        'lamente': 'Configura el rango de números para el desafío mental.',
        'imitador': 'Crea una sala de imitaciones y risas aseguradas.',
        'cofres': 'Configura el número de cofres para tu partida.',
        'bolita': 'Configura los bumpers (obstáculos de rebote) de tu tablero de Plinko.'
    };

    const title = gameTitles[gameType] || 'Crear Sala - JuegosBeber.es';
    const description = gameDescriptions[gameType] || 'Crea tu propia sala de juegos beber online.';

    if (gameType === 'horse-race') {
        res.render('admin-horse-race', { title, description, gameType });
    } else if (gameType === 'voting') {
        res.render('admin-voting', { title, description, gameType });
    } else if (gameType === 'roulette') {
        res.render('admin-roulette', { title, description, gameType });
    } else if (gameType === 'pyramid') {
        res.render('admin-pyramid', { title, description, gameType });
    } else if (gameType === 'autobus') {
        res.render('admin-autobus', { title, description, gameType });
    } else if (gameType === 'lamente') {
        res.render('admin-lamente', { title, description, gameType });
    } else if (gameType === 'imitador') {
        res.render('admin-imitador', { title, description, gameType });
    } else if (gameType === 'cofres') {
        res.render('admin-cofres', { title, description, gameType });
    } else if (gameType === 'bolita') {
        res.render('admin-bolita', { title, description, gameType });
    } else {
        res.status(404).send('Tipo de juego no válido.');
    }
});

// ADDED: Route for re-entering an admin panel for an existing room
app.get('/admin/:gameType/:roomId', (req, res) => {
    const { gameType, roomId } = req.params;
    if (gameType === 'lamente') {
        res.render('admin-lamente', { title: `Panel de Admin - La Mente`, gameType });
    } else {
        res.redirect(`/admin/${gameType}`); // Redirect to base admin page for other games
    }
});

app.post('/api/rooms/:gameType', async (req, res) => {
    const { gameType } = req.params;
    const { name, password, settings, creatorId, update_room_id } = req.body;

    if (gameType === 'voting' && update_room_id) {
        const roomToUpdate = await db.getRoomById(update_room_id);
        if (roomToUpdate && roomToUpdate.creatorId === creatorId) {
            console.log(`[Server] Actualizando votación en la sala ${update_room_id}`);
            let gameState = await db.getGameState(update_room_id);
            if (!gameState) return res.status(404).json({ message: "Estado de juego no encontrado para actualizar." });

            gameState = createVotingState({ name, ...settings });
            gameState.phase = 'waiting';
            gameState.endTime = null;

            await db.updateGameState(update_room_id, gameState);
            await db.updateRoom(update_room_id, { name: name || settings.name || `Sala de votación`, isPublic: !password, password: password || null });

            const stateToSend = getSanitizedGameState(gameState);
            stateToSend.roomAdminId = roomToUpdate.creatorId;
            io.to(update_room_id).emit('roomState', stateToSend);
            return res.status(200).json({ roomId: update_room_id });
        }
    }

    const roomId = uuidv4().slice(0, 8);
    let initialState = {};
    if (gameType === 'horse-race') {
        initialState = createHorseRaceState();
        if (settings) initialState.settings = { ...initialState.settings, ...settings };
    } else if (gameType === 'voting') {
        initialState = createVotingState({ name, ...settings });
    } else if (gameType === 'roulette') {
        initialState = createRouletteState(settings);
    } else if (gameType === 'pyramid') {
        initialState = createPyramidState(settings);
    } else if (gameType === 'autobus') {
        initialState = createAutobusState();
    } else if (gameType === 'lamente') {
        initialState = createLamenteState(settings);
    } else if (gameType === 'imitador') {
        initialState = createImitadorState(settings);
    } else if (gameType === 'cofres') {
        initialState = createCofresState(settings);
    } else if (gameType === 'bolita') {
        initialState = createBolitaState(settings);
    }

    const newRoom = {
        id: roomId,
        name: name || settings.name || `Sala de ${gameType}`,
        gameType: gameType,
        isPublic: !password,
        password: password || null,
        creatorId: creatorId,
    };

    await db.createRoom(newRoom);
    await db.createGameState(roomId, initialState);

    console.log(`[Server] Sala creada: [${gameType}] ${roomId} por ${creatorId}`);
    res.status(201).json({ roomId, creatorId });
});

io.on('connection', (socket) => {
    console.log(`[Server] Usuario conectado: ${socket.id}`);

    // Unirse a la sala de eventos del dashboard de estadísticas
    socket.on('analytics:join_dashboard', async () => {
        // (clon) Antes cualquiera podía unirse y recibir cada visita en directo (ciudad, página...)
        if (STATS_PASSWORD && !hasStatsCookie(socket.handshake.headers.cookie)) return;
        socket.join('analytics_dashboard');
        try {
            const active = await analyticsDb.getActiveUsers(db.pool);
            socket.emit('analytics:active_count', active.count);
        } catch (e) {}
    });

    socket.on('joinRoom', async ({ gameType, roomId, user }) => {
        console.log(`[Server] Join request for RoomId: ${roomId}, GameType: ${gameType}, User: ${user.name} (${user.uuid}), Socket: ${socket.id}`);
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== gameType) {
            console.log(`[Server] Error: Sala no existe o tipo de juego no coincide. Room: ${roomId}, GameType: ${gameType}`);
            return socket.emit('error', { message: 'La sala no existe o el tipo de juego no coincide.' });
        }

        // Password check
        if (room.password && room.password !== user.password && room.creatorId !== user.uuid) {
            console.log(`[Server] Error: Contraseña incorrecta para RoomId: ${roomId}, User: ${user.name}`);
            return socket.emit('error', { message: 'Contraseña incorrecta.' });
        }

        // const ipAddress = socket.handshake.address; // Not used

        socket.join(roomId);
        socket.roomId = roomId;
        socket.userUuid = user.uuid;
        let gameState = await db.getGameState(roomId);
        if (!gameState) {
            console.log(`[Server] Error: Estado de juego no encontrado para RoomId: ${roomId}`);
            return socket.emit('error', { message: 'Estado de juego no encontrado.' });
        }

        if (gameState.players) {
            let player = gameState.players.find(p => p.uuid === user.uuid);
            if (player) {
                console.log(`[Server] Reconnecting player: ${user.name} (${user.uuid}) to RoomId: ${roomId}. Old socket: ${player.id}, New socket: ${socket.id}`);
                player.id = socket.id;
                player.online = true;
                if (user.name && user.name !== 'Anónimo') {
                    player.name = user.name;
                }
                
                // If reconnecting to a 'lamente' game in progress, restore their state
                if (gameType === 'lamente' && gameState.phase === 'playing' && player.number !== null) {
                    console.log(`[Server] Reconnecting La Mente player ${user.name} (${user.uuid}) in PLAYING phase. Number: ${player.number}, Remaining: ${gameState.remainingPlayers.length}`);
                    socket.emit('gameStarted', {
                        number: player.number,
                        range: { min: gameState.settings.min, max: gameState.settings.max },
                        remainingCount: gameState.remainingPlayers.length
                    });
                    
                    // Also check if they already guessed correctly
                    const alreadyGuessed = gameState.lastPlayerOrder.includes(user.uuid);
                    if(alreadyGuessed) {
                         console.log(`[Server] Reconnecting player ${user.name} already guessed correctly. `);
                         socket.emit('playerGuessedCorrectly', { 
                            remainingCount: gameState.remainingPlayers.length,
                            playerName: player.name
                        });
                    }
                }

                // If reconnecting to 'autobus', ensure their cards are available
                if (gameType === 'autobus') {
                    if (!player.currentCards) player.currentCards = [];
                    console.log(`[Server] Reconnecting Autobús player ${user.name} (${user.uuid}). Cards: ${player.currentCards.length}`);
                }

            } else {
                // New player
                console.log(`[Server] New player joining: ${user.name} (${user.uuid}) to RoomId: ${roomId}. Socket: ${socket.id}`);
                player = { 
                    id: socket.id, 
                    uuid: user.uuid,
                    name: user.name || 'Anónimo',
                    online: true
                };

                // Logic to handle reconnects for La Mente if the player was dropped
                if (gameType === 'lamente' && gameState.phase === 'playing' && gameState.roundPlayers) {
                    const originalPlayerData = gameState.roundPlayers.find(p => p.uuid === user.uuid);
                    if (originalPlayerData) {
                        console.log(`[Server] Player ${user.name} is re-joining a game in progress. Restoring number: ${originalPlayerData.number}`);
                        player.number = originalPlayerData.number;
                    }
                }

                 if (gameType === 'roulette') {
                    player.sips = gameState.settings.initialSips;
                } else if (gameType === 'lamente') {
                    if (player.number === undefined) { // Ensure number property exists
                        player.number = null; // Number assigned later
                    }
                }
                if (gameType === 'autobus') {
                    // (clon) entrar con la partida empezada: sin esto, al llegarle el turno el servidor fallaba
                    Object.assign(player, { currentCards: [], drinksToTake: 0, totalDrinks: 0, hasWon: false, message: '' });
                }
                gameState.players.push(player);
            }
            cancelPendingRemoval(roomId, user.uuid);
        }
        
        if (gameType === 'bolita' && gameState.phase === 'playing') {
            if (gameState.turnOrder && !gameState.turnOrder.includes(user.uuid)) {
                gameState.turnOrder.push(user.uuid);
                console.log(`[Server] Mid-game join for La Bolita: Added ${user.name} (${user.uuid}) to turnOrder.`);
            }
        }

        await db.updateGameState(roomId, gameState); // Persist updated state
        console.log(`[Server] User ${user.uuid} joined room ${roomId}. Players in room: ${gameState.players.length}`);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        stateToSend.id = roomId; // Add roomId to the stateToSend
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('lamente:startGame', async ({ roomId, userId, settings }) => {
        console.log(`[Server] lamente:startGame request for RoomId: ${roomId} by User: ${userId}`);
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) {
            console.log(`[Server] Error: StartGame unauthorized or room not found. Room: ${roomId}, User: ${userId}`);
            return;
        }

        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'waiting') {
            console.log(`[Server] Error: GameState not found or not in WAITING phase. Room: ${roomId}, Phase: ${gameState ? gameState.phase : 'N/A'}`);
            return;
        }

        console.log(`[Server] Admin ${userId} iniciando partida de La Mente en la sala ${roomId}`);

        // Update gameState with the new settings from the client
        if (settings) {
            gameState.settings.min = parseInt(settings.min, 10) || 1;
            gameState.settings.max = parseInt(settings.max, 10) || 100;
            console.log(`[Server] Received new settings. Range: ${gameState.settings.min}-${gameState.settings.max}`);
        }

        // Reset player numbers and any previous game state properties
        gameState.players.forEach(p => p.number = null);
        gameState.remainingPlayers = [];
        gameState.lastPlayerOrder = [];
        console.log(`[Server] GameState reset for new game. Players count: ${gameState.players.length}`);

        // Clear any existing timeout for this game
        if (lamenteTimeouts[roomId]) {
            clearInterval(lamenteTimeouts[roomId]);
            delete lamenteTimeouts[roomId];
            console.log(`[Server] Cleared existing lamenteTimeout for Room: ${roomId}`);
        }

        gameState.phase = 'countdown';
        const countdown = 5; // Countdown is always 5 seconds
        console.log(`[Server] Starting countdown: ${countdown}s for Room: ${roomId}`);

        io.to(roomId).emit('gameStarting', countdown);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend); // Update all clients with new phase

        let countdownValue = countdown;
        lamenteTimeouts[roomId] = setInterval(async () => { // Store in lamenteTimeouts map
            io.to(roomId).emit('countdownTick', countdownValue);
            countdownValue--;
            console.log(`[Server] Countdown tick for Room: ${roomId}, Value: ${countdownValue}`);

            // Update game state in DB for countdown (not optional now, but without currentTimeout)
            // Need a copy of gameState to avoid modifying the one used by setInterval
            let stateToPersist = { ...gameState };
            // Ensure currentTimeout is not present when persisting
            await db.updateGameState(roomId, getSanitizedGameState(stateToPersist)); // Persist without currentTimeout

            if (countdownValue < 0) {
                console.log(`[Server] Countdown finished for Room: ${roomId}. Starting game.`);
                clearInterval(lamenteTimeouts[roomId]); // Clear using lamenteTimeouts map
                delete lamenteTimeouts[roomId]; // Remove from map
                
                // Fetch fresh state before starting the game
                let currentGameState = await db.getGameState(roomId);
                currentGameState.phase = 'playing'; // Update phase immediately

                const playerCount = currentGameState.players.length;
                if (playerCount === 0) {
                    console.log("[Server] No hay jugadores para empezar la partida de La Mente.");
                    currentGameState.phase = 'waiting';
                    await db.updateGameState(roomId, currentGameState);
                    const stateToSend = getSanitizedGameState(currentGameState);
                    stateToSend.roomAdminId = room.creatorId; // ADDED
                    io.to(roomId).emit('roomState', stateToSend);
                    return;
                }

                // Adjust range if necessary
                const min = currentGameState.settings.min;
                const max = currentGameState.settings.max;
                if ((max - min + 1) < playerCount) {
                    currentGameState.settings.max = min + playerCount - 1;
                    console.log(`[Server] Rango de La Mente ajustado a: ${min}-${currentGameState.settings.max}`);
                }

                // Generate unique numbers for players
                // The currentGameState already includes all players who joined before the countdown started.
                // Re-fetching the state here would overwrite the `phase: 'playing'` change.
                if (!currentGameState) { // Safety check
                    console.error(`[Server] Error: GameState is unexpectedly null for RoomId: ${roomId} before number assignment.`);
                    return;
                }
                // Also update playerCount in case it changed
                const updatedPlayerCount = currentGameState.players.length;
                if (updatedPlayerCount === 0) {
                    console.log("[Server] No players after re-fetching gameState. Reverting to waiting.");
                    currentGameState.phase = 'waiting';
                    await db.updateGameState(roomId, currentGameState);
                    const stateToSend = getSanitizedGameState(currentGameState); // Prepare state to send
                    const room = await db.getRoomById(roomId); // Fetch room to get creatorId
                    if (room) {
                        stateToSend.roomAdminId = room.creatorId;
                    }
                    io.to(roomId).emit('roomState', stateToSend); // Emit with roomAdminId
                    return;
                }
                
                // Adjust range again if necessary with updated player count
                if ((currentGameState.settings.max - currentGameState.settings.min + 1) < updatedPlayerCount) {
                    currentGameState.settings.max = currentGameState.settings.min + updatedPlayerCount - 1;
                    console.log(`[Server] Rango de La Mente adjusted again to: ${currentGameState.settings.min}-${currentGameState.settings.max} due to updated player count.`);
                }

                const numbers = new Set();
                while(numbers.size < updatedPlayerCount) { // Use updatedPlayerCount
                    const randomNumber = Math.floor(Math.random() * (currentGameState.settings.max - currentGameState.settings.min + 1)) + currentGameState.settings.min;
                    numbers.add(randomNumber);
                }
                const numbersArray = Array.from(numbers);

                currentGameState.players.forEach((player, index) => {
                    player.number = numbersArray[index];
                    console.log(`[Server] Assigned number ${player.number} to player ${player.name} (${player.uuid})`);
                });

                // Save a snapshot of the players with their numbers for this round
                currentGameState.roundPlayers = JSON.parse(JSON.stringify(currentGameState.players));

                // Sort players by their numbers to get the correct order
                currentGameState.remainingPlayers = currentGameState.players.map(p => p.uuid).sort((a, b) => {
                    const playerA = currentGameState.players.find(p => p.uuid === a);
                    const playerB = currentGameState.players.find(p => p.uuid === b);
                    return playerA.number - playerB.number;
                });
                currentGameState.lastPlayerOrder = []; // Reset last player order
                console.log(`[Server] Game started. RemainingPlayers order: ${currentGameState.remainingPlayers.join(', ')}`);

                await db.updateGameState(roomId, currentGameState);
                
                // Send personalized game started event to each player
                currentGameState.players.forEach(p => {
                    console.log(`[Server] Emitting gameStarted to player ${p.name} (${p.uuid}) with number: ${p.number}`);
                    io.to(p.id).emit('gameStarted', {
                        number: p.number,
                        range: { min: currentGameState.settings.min, max: currentGameState.settings.max },
                        remainingCount: currentGameState.remainingPlayers.length
                    });
                });
                const stateToSend = getSanitizedGameState(currentGameState);
                stateToSend.roomAdminId = room.creatorId;
                io.to(roomId).emit('roomState', stateToSend); // Update all clients with new state
            }
        }, 1000);

        // Persist initial countdown state (without currentTimeout)
        // Need a copy of gameState to avoid modifying the one used by setInterval
        let stateToPersistInitial = { ...gameState };
        await db.updateGameState(roomId, getSanitizedGameState(stateToPersistInitial));
    });

    socket.on('lamente:pressVoy', async ({ roomId, userId }) => {
        console.log(`[Server] lamente:pressVoy request for RoomId: ${roomId} by User: ${userId}`);
        const room = await db.getRoomById(roomId); // Added this line
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'playing') {
            console.log(`[Server] Error: PressVoy in wrong phase or no gameState. Room: ${roomId}, User: ${userId}, Phase: ${gameState ? gameState.phase : 'N/A'}`);
            return;
        }

        const player = gameState.players.find(p => p.uuid === userId);
        if (!player) {
            console.log(`[Server] Error: Player ${userId} not found in gameState for Room: ${roomId}`);
            return;
        }
        if (!gameState.remainingPlayers.includes(player.uuid)) {
            console.log(`[Server] Error: Player ${player.name} (${userId}) not in remainingPlayers for Room: ${roomId}. Already guessed or not their turn.`);
            return;
        }

        const correctPlayerUUID = gameState.remainingPlayers[0];
        console.log(`[Server] Player ${player.name} pressed VOY. Correct player should be ${correctPlayerUUID}.`);

        if (player.uuid === correctPlayerUUID) {
            // Correct guess
                        const [guessedPlayerUUID] = gameState.remainingPlayers.splice(0, 1);
                        gameState.lastPlayerOrder.push(guessedPlayerUUID);
                        console.log(`[Server] Correct guess by ${player.name}. Remaining players count: ${gameState.remainingPlayers.length}`);
            
                        // NEW: Store last correct guess info
                        gameState.lastCorrectGuess = {
                            name: player.name,
                            number: player.number
                        };
            
                        io.to(roomId).emit('playerGuessedCorrectly', {
                            remainingCount: gameState.remainingPlayers.length,
                            playerName: player.name
                        });
            
                        if (gameState.remainingPlayers.length === 0) {
                            // Game won
                            gameState.phase = 'finished';
                            delete gameState.lastCorrectGuess; // Clear on game end
                             io.to(roomId).emit('gameOver', {
                                win: true,
                                results: gameState.players.map(p => ({ name: p.name, number: p.number, uuid: p.uuid })).sort((a, b) => a.number - b.number),
                                correctlyGuessedPlayers: gameState.lastPlayerOrder
                            });
                        }
                    } else {
                        // Wrong guess, game over
                        gameState.phase = 'finished';
                        delete gameState.lastCorrectGuess; // Clear on game end
                        console.log(`[Server] Wrong guess by ${player.name}. Game LOST for Room: ${roomId}.`);
                        io.to(roomId).emit('gameOver', {
                            win: false,
                            failingPlayerUUID: player.uuid,
                            results: gameState.players.map(p => ({ name: p.name, number: p.number, uuid: p.uuid })).sort((a, b) => a.number - b.number),
                            correctlyGuessedPlayers: gameState.lastPlayerOrder
                        });        }
        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });


    socket.on('lamente:resetGame', async ({ roomId, userId }) => {
        console.log(`[Server] lamente:resetGame request for RoomId: ${roomId} by User: ${userId}`);
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) {
            console.log(`[Server] Error: ResetGame unauthorized or room not found. Room: ${roomId}, User: ${userId}`);
            return;
        }

        let gameState = await db.getGameState(roomId);
        if (!gameState) {
            console.log(`[Server] Error: GameState not found for ResetGame in Room: ${roomId}`);
            return;
        }
        
        console.log(`[Server] Admin ${userId} reseteando La Mente en ${roomId}`);

        // Clear any active game interval/timeout
        if (lamenteTimeouts[roomId]) {
            clearInterval(lamenteTimeouts[roomId]);
            delete lamenteTimeouts[roomId]; // Remove from map
            console.log(`[Server] Cleared lamenteTimeout for Room: ${roomId} during reset.`);
        }

        const originalSettings = gameState.settings;
        const originalPlayers = gameState.players; // Keep players, but reset their state

        let newGameState = createLamenteState(originalSettings);
        newGameState.players = originalPlayers;
        newGameState.players.forEach(p => p.number = null); // Clear numbers
        newGameState.lastCorrectGuess = null; // NEW: Initialize lastCorrectGuess
        console.log(`[Server] New GameState created for Room: ${roomId} after reset.`);

        await db.updateGameState(roomId, newGameState);
        const stateToSend = getSanitizedGameState(newGameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
        io.to(roomId).emit('gameReset'); // Notify clients to go to waiting screen
    });


    socket.on('placeBet', async ({ roomId, player }) => {
        const room = await db.getRoomById(roomId);
        if (!room) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.game !== 'horse-race') return;

        // Allow bets only in 'waiting' phase (or remove phase check if bets allowed anytime before end)
        if (gameState.phase !== 'waiting') return; 

        const playerIndex = gameState.players.findIndex(p => p.uuid === player.uuid);
        if (playerIndex !== -1) {
            gameState.players[playerIndex] = { ...gameState.players[playerIndex], ...player };
            console.log(`[Server] Apuesta recibida de ${player.name} en la sala ${roomId}`);
            await db.updateGameState(roomId, gameState); // Persist updated state
            const stateToSend = getSanitizedGameState(gameState);
            stateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', stateToSend);
        }
    });

    socket.on('manualStart', async ({ roomId, gameType, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.players.length < 2 || gameState.phase !== 'waiting') return;
        console.log(`[Server] Manual start request for RoomId: ${roomId}, GameType: ${gameType}, User: ${userId}`);
        await startRace(roomId, gameType);
    });

    socket.on('start-pyramid', async ({ roomId, userId, levels }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'waiting') return;
        if (gameState.players.length < 2) {
            console.log(`[Server] Error: Not enough players for Pyramid in Room: ${roomId}`);
            return socket.emit('error', { message: 'Se necesitan al menos 2 jugadores para empezar.' });
        }

        console.log(`[Server] Iniciando La Pirámide en la sala ${roomId}`);
        gameState.phase = 'playing';
        gameState.settings.levels = parseInt(levels, 10) || 4;
        
        // Simultaneous play state
        gameState.playersFinishedThisRound = []; // UUIDs of players who passed or used all cards
        gameState.pendingActions = []; // Action queue for challenges

        // (clon) con muchos jugadores no hay cartas para todos: avisar en vez de repartir cartas vacías
        const pyramidCards = gameState.settings.levels * (gameState.settings.levels + 1) / 2;
        const maxPlayersNow = Math.floor((createDeck().length - pyramidCards) / 2);
        if (gameState.players.length > maxPlayersNow) {
            return socket.emit('error', { message: `Con ${gameState.settings.levels} pisos caben como máximo ${maxPlayersNow} jugadores. Baja los pisos o sobra gente.` });
        }

        const deck = shuffleDeck(createDeck());

        gameState.playerHands = {};
        gameState.players.forEach(player => {
            gameState.playerHands[player.uuid] = [];
            for (let i = 0; i < 2; i++) {
                gameState.playerHands[player.uuid].push({ card: deck.pop(), used: false });
            }
        });

        gameState.pyramid = [];
        // Pyramid: Start with the base (e.g., 4 cards) and go up to the top (1 card)
        for (let i = gameState.settings.levels; i >= 1; i--) {
            const row = [];
            for (let j = 0; j < i; j++) {
                row.push({ card: deck.pop(), revealed: false });
            }
            gameState.pyramid.push(row);
        }

        await db.updateGameState(roomId, gameState);
        await revealNextPyramidCard(roomId);
    });

    async function revealNextPyramidCard(roomId) {
        let gameState = await db.getGameState(roomId);
        if (!gameState) return;

        // Reset for the new round/card
        gameState.playersFinishedThisRound = [];
        gameState.pendingActions = [];
        gameState.drinksThisRound = {}; // Reset drinks counter
        gameState.actionLog = []; // Clear the action log for the new round
        
        // RESET: Allow players to use their 2 cards again for this new pyramid card
        Object.values(gameState.playerHands).forEach(hand => {
            hand.forEach(card => card.used = false);
        });

        let cardRevealed = false;
        const flatPyramid = gameState.pyramid.flat();

        if (gameState.currentCardIndex < flatPyramid.length) {
            flatPyramid[gameState.currentCardIndex].revealed = true;
            cardRevealed = true;
            gameState.currentCardIndex++;
            const cardName = `${flatPyramid[gameState.currentCardIndex - 1].card.number} de ${flatPyramid[gameState.currentCardIndex - 1].card.suit}`;
            gameState.actionLog.push(`[Server] Se ha revelado una nueva carta: ${cardName}.`);
        } else {
            gameState.phase = 'finished';
            gameState.actionLog.push('[Server] Fin del juego.');
        }

        await db.updateGameState(roomId, gameState);
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    }

    async function checkIfRoundIsOver(roomId) {
        let gameState = await db.getGameState(roomId);
        if (!gameState) return;

        // (clon) cuentan solo los que están y tienen cartas (quien entra a mitad o se ha ido no bloquea la ronda)
        const inRound = gameState.players.filter(p => gameState.playerHands && gameState.playerHands[p.uuid]);
        if (inRound.every(p => gameState.playersFinishedThisRound.includes(p.uuid))) {
            // Emit the state one last time to hide buttons for the last player
            io.to(roomId).emit('roomState', getSanitizedGameState(gameState));

            gameState.actionLog.push('[Server] Todos han actuado. Revelando siguiente carta...');
            const hasDrinks = Object.values(gameState.drinksThisRound || {}).some(d => d > 0);
            const delay = hasDrinks ? 10000 : 2000; // 10s delay if drinks were given

            await db.updateGameState(roomId, gameState);
            setTimeout(() => revealNextPyramidCard(roomId), delay);
        } else {
            io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
        }
    }

    socket.on('pyramid:send-drink', async ({ roomId, targetPlayerUuid, handCardIndex }) => {
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'playing') return;

        const sender = gameState.players.find(p => p.id === socket.id);
        if (!sender || gameState.playersFinishedThisRound.includes(sender.uuid)) return;

        const senderHand = gameState.playerHands[sender.uuid];

        const target = gameState.players.find(p => p.uuid === targetPlayerUuid);
        if (!target || !senderHand || senderHand[handCardIndex].used) return;

        gameState.pendingActions.push({
            sender: { uuid: sender.uuid, name: sender.name },
            target: { uuid: target.uuid, name: target.name, id: target.id },
            handCardIndex: handCardIndex
        });

        await db.updateGameState(roomId, gameState);
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    });

    socket.on('pyramid:resolve-action', async ({ roomId, resolution }) => {
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.pendingActions.length === 0) return;

        const action = gameState.pendingActions[0];
        const target = gameState.players.find(p => p.uuid === action.target.uuid);
        if (!target || target.id !== socket.id) return;

        const sender = gameState.players.find(p => p.uuid === action.sender.uuid);
        const flatPyramid = gameState.pyramid.flat();
        const pyramidCardWrapper = flatPyramid[gameState.currentCardIndex - 1];
        const pyramidCard = pyramidCardWrapper.card;
        
        // Fix level calculation: find which row contains the current card
        let level = 1;
        for (let i = 0; i < gameState.pyramid.length; i++) {
            if (gameState.pyramid[i].includes(pyramidCardWrapper)) {
                level = i + 1;
                break;
            }
        }
        
        let drinks = 0;
        let drinkerUuid = null;
        let toastMessage = '';

        if (resolution === 'accept') {
            drinks = level;
            drinkerUuid = target.uuid;
            toastMessage = `¡${target.name} acepta y bebe ${drinks} trago(s)!`;
            gameState.actionLog.push(toastMessage);
        } else if (resolution === 'challenge') {
            const senderCard = gameState.playerHands[sender.uuid][action.handCardIndex].card;
            const senderCardName = `${senderCard.number} de ${senderCard.suit}`;
            gameState.actionLog.push(`¡${target.name} desafía! ${sender.name} enseña un ${senderCardName}.`);
            
            if (senderCard.number === pyramidCard.number) {
                // Sender was telling the truth
                drinks = level * 2;
                drinkerUuid = target.uuid;
                toastMessage = `¡Desafío fallido! ${target.name} bebe ${drinks} tragos.`;
            } else {
                // Sender was lying
                drinks = level * 2;
                drinkerUuid = sender.uuid;
                toastMessage = `¡Cazado! ${sender.name} mentía y bebe ${drinks} tragos.`;
            }
            gameState.actionLog.push(toastMessage);
        }

        if (drinkerUuid) {
            if (!gameState.drinksThisRound) gameState.drinksThisRound = {};
            if (!gameState.drinksThisRound[drinkerUuid]) gameState.drinksThisRound[drinkerUuid] = 0;
            gameState.drinksThisRound[drinkerUuid] += drinks;
        }

        if (toastMessage) {
            io.to(roomId).emit('pyramid:show-toast', { message: toastMessage });
        }

        gameState.playerHands[sender.uuid][action.handCardIndex].used = true;
        gameState.pendingActions.shift();

        const senderHand = gameState.playerHands[sender.uuid];
        const usedCardsCount = senderHand.filter(c => c.used).length;
        if (usedCardsCount >= 2 && !gameState.playersFinishedThisRound.includes(sender.uuid)) {
            gameState.playersFinishedThisRound.push(sender.uuid);
        }

        await db.updateGameState(roomId, gameState);
        await checkIfRoundIsOver(roomId);
    });

    socket.on('pyramid:reset-game', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'finished') return;

        console.log(`[Server] Reiniciando juego de Pirámide en la sala ${roomId}`);
        const originalPlayers = gameState.players;
        const originalSettings = gameState.settings;

        let newGameState = createPyramidState(originalSettings);
        newGameState.players = originalPlayers; // Keep the players

        await db.updateGameState(roomId, newGameState);
        io.to(roomId).emit('roomState', getSanitizedGameState(newGameState));
    });

    socket.on('pyramid:pass-turn', async ({ roomId }) => {
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'playing') return;

        const player = gameState.players.find(p => p.id === socket.id);
        if (!player || gameState.playersFinishedThisRound.includes(player.uuid)) return;

        gameState.actionLog.push(`${player.name} ha pasado.`);
        gameState.playersFinishedThisRound.push(player.uuid);
        
        await db.updateGameState(roomId, gameState);
        await checkIfRoundIsOver(roomId);
    });

    pyramidRoundCheck = checkIfRoundIsOver;

    async function checkIfTurnIsOver(roomId) {
        let gameState = await db.getGameState(roomId);
        if (!gameState) return;

        if (gameState.actionsThisTurn.length >= gameState.players.length) {
            gameState.actionLog.push('[Server] Todos han actuado. Revelando siguiente carta...');
            await db.updateGameState(roomId, gameState);
            setTimeout(() => revealNextPyramidCard(roomId), 2000);
        } else {
            io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
        }
    }

    socket.on('startVoting', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== 'voting') {
            console.log(`[Server] Intento de inicio de votación en sala inexistente por ${userId} en la sala ${roomId}`);
            return socket.emit('error', { message: 'La sala de votación no existe o ha sido eliminada.' });
        }
        let gameState = await db.getGameState(roomId);
        if (!gameState) return socket.emit('error', { message: 'Estado de juego no encontrado.' });

        if (room.creatorId !== userId || gameState.phase !== 'waiting') {
            console.log(`[Server] Intento de inicio de votación no autorizado o en fase incorrecta por ${userId} en la sala ${roomId}`);
            return socket.emit('error', { message: 'No tienes permiso para iniciar la votación o la votación ya ha comenzado.' });
        }

        console.log(`[Server] Iniciando votación en la sala ${roomId} por el administrador.`);
        gameState.phase = 'voting';
        gameState.endTime = Date.now() + (gameState.settings.duration * 1000);

        const durationMs = gameState.settings.duration * 1000;
        activeGameIntervals[roomId] = setTimeout(async () => { // Use activeGameIntervals
            let currentGameState = await db.getGameState(roomId);
            if (currentGameState && currentGameState.phase === 'voting') {
                console.log(`[Server] Votación finalizada en la sala ${roomId} (automático).`);
                currentGameState.phase = 'finished';
                await db.updateGameState(roomId, currentGameState);
                const stateToSend = getSanitizedGameState(currentGameState);
                stateToSend.roomAdminId = room.creatorId;
                io.to(roomId).emit('roomState', stateToSend);
            }
            delete activeGameIntervals[roomId]; // Clear interval from map
        }, durationMs);

        await db.updateGameState(roomId, gameState); // Persist updated state
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('submitVote', async ({ roomId, optionName, uuid }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== 'voting') return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'voting') return;

        const option = gameState.options.find(opt => opt.name === optionName);
        if (!option) return;

        const previousVote = gameState.votes[uuid];
        if (previousVote === optionName) {
            option.votes--;
            delete gameState.votes[uuid];
        } else {
            if (previousVote) {
                const previousOption = gameState.options.find(opt => opt.name === previousVote);
                if (previousOption) previousOption.votes--;
            }
            option.votes++;
            gameState.votes[uuid] = optionName;
        }
        await db.updateGameState(roomId, gameState); // Persist updated state
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    });

    socket.on('resetGame', async ({ roomId, gameType, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) {
            console.log(`[Server] Intento de reinicio no autorizado por ${userId} en la sala ${roomId}`);
            return;
        }
        let gameState = await db.getGameState(roomId);
        if (!gameState) return;

        console.log(`[Server] Reiniciando juego en la sala ${roomId} por el administrador.`);

        // Clear any active game interval
        if (activeGameIntervals[roomId]) {
            clearInterval(activeGameIntervals[roomId]);
            delete activeGameIntervals[roomId];
        }

        if (gameType === 'horse-race') {
            const currentPlayers = gameState.players.map(p => ({ uuid: p.uuid, name: p.name, id: p.id }));
            const originalSettings = gameState.settings;
            
            gameState = createHorseRaceState();
            gameState.settings = originalSettings;
            gameState.players = currentPlayers;

            await db.updateGameState(roomId, gameState); // Persist updated state
            const stateToSend = getSanitizedGameState(gameState);
            stateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', stateToSend);
        } else if (gameType === 'voting') {
            const originalSettings = gameState.settings;
            gameState = createVotingState(originalSettings);
            gameState.phase = 'waiting'; // Reset to waiting phase
            gameState.endTime = null; // Clear end time
            // gameState.originalSettings = originalSettings; // No need to pass original settings back, they are in gameState.settings

            await db.updateGameState(roomId, gameState); // Persist updated state
            const stateToSend = getSanitizedGameState(gameState);
            stateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', stateToSend);
        } else if (gameType === 'roulette') { // Add roulette reset logic
            const originalSettings = gameState.settings;
            gameState = createRouletteState(originalSettings);
            gameState.players = gameState.players.map(p => ({ ...p, sips: originalSettings.initialSips })); // Reset sips
            
            await db.updateGameState(roomId, gameState);
            const stateToSend = getSanitizedGameState(gameState);
            stateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', stateToSend);
        } else if (gameType === 'autobus') {
            const currentPlayers = gameState.players;
            gameState = createAutobusState();
            gameState.players = currentPlayers.map(p => ({ 
                uuid: p.uuid, 
                name: p.name, 
                id: p.id,
                online: p.online !== undefined ? p.online : true,
                totalDrinks: 0,
                currentCards: [],
                hasWon: false,
                message: '',
                drinksToTake: 0
            }));
            
            await db.updateGameState(roomId, gameState);
            const stateToSend = getSanitizedGameState(gameState);
            stateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', stateToSend);
        }
    });

    socket.on('roulette:startGame', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== 'roulette' || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'waiting') return;
        
        console.log(`[Server] Iniciando partida de ruleta en la sala ${roomId}`);
        await startRouletteBetting(roomId);
    });

    socket.on('roulette:placeBet', async ({ roomId, user, bet }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== 'roulette') return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'betting') return;

        const player = gameState.players.find(p => p.uuid === user.uuid);
        if (!player || player.sips < bet.amount) {
            return;
        }

        player.sips -= bet.amount;

        if (!gameState.bets[user.uuid]) {
            gameState.bets[user.uuid] = [];
        }

        // Check for existing bet
        const existingBet = gameState.bets[user.uuid].find(
            b => b.type === bet.type && b.value === bet.value
        );

        if (existingBet) {
            existingBet.amount += bet.amount; // Add to existing bet
        } else {
            gameState.bets[user.uuid].push(bet); // Add new bet
        }

        await db.updateGameState(roomId, gameState); // Persist updated state
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    });

    socket.on('roulette:distributeSips', async ({ roomId, user, distribution }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== 'roulette') return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'distributing') return;

        const sender = gameState.players.find(p => p.uuid === user.uuid);
        if (!sender) return;

        // Verify the sender is a winner of the round
        const isWinner = gameState.winners.some(w => w.uuid === sender.uuid);
        if (!isWinner) return; // Only winners can distribute

        let totalCost = 0;
        for (const targetUuid in distribution) {
            const amount = parseInt(distribution[targetUuid], 10) || 0;
            totalCost += amount * gameState.settings.drinkPrice;
        }

        if (sender.sips < totalCost) {
            // Not enough points, maybe send a notification back to the sender?
            return;
        }

        sender.sips -= totalCost;
        sender.hasDistributed = true; // Mark player as having distributed

        if (!gameState.sipDistributionLog) {
            gameState.sipDistributionLog = [];
        }

        for (const targetUuid in distribution) {
            const amount = parseInt(distribution[targetUuid], 10) || 0;
            const targetPlayer = gameState.players.find(p => p.uuid === targetUuid);

            if (amount > 0 && targetPlayer) {
                // Log the distribution
                gameState.sipDistributionLog.push({
                    to_uuid: targetPlayer.uuid,
                    from_uuid: sender.uuid,
                    to_name: targetPlayer.name,
                    from_name: sender.name,
                    amount: amount
                });

                // Emit a notification to the target player
                io.to(targetPlayer.id).emit('roulette:drinksReceived', {
                    from: sender.name,
                    amount: amount
                });
            }
        }
        
        await db.updateGameState(roomId, gameState);
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    });

    socket.on('horse_race:distribute_drinks', async ({ roomId, winnerUuid, distribution }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== 'horse-race') return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'distributing') return;

        const winnerPlayer = gameState.players.find(p => p.uuid === winnerUuid);
        // Check if the winner has already distributed drinks
        if (!winnerPlayer || gameState.winnersDistributedDrinks.includes(winnerUuid)) {
            console.log(`[Server] Winner ${winnerPlayer.name} (${winnerUuid}) has already distributed drinks for race ${room.name}.`);
            return;
        }

        // Log that the winner has distributed drinks
        gameState.winnersDistributedDrinks.push(winnerUuid);

        // Initialize the log if it doesn't exist
        if (!gameState.sipDistributionLog) {
            gameState.sipDistributionLog = [];
        }

        for (const playerUuid in distribution) {
            const amount = distribution[playerUuid];
            if (amount > 0) {
                const playerToReceive = gameState.players.find(p => p.uuid === playerUuid);
                if (playerToReceive) {
                    // Log the distribution
                    gameState.sipDistributionLog.push({
                        to_uuid: playerToReceive.uuid,
                        to_name: playerToReceive.name,
                        from_name: winnerPlayer.name,
                        amount: amount
                    });
                    // Emit drinks_received to the target player
                    io.to(playerToReceive.id).emit('horse_race:drinks_received', {
                        from: winnerPlayer.name,
                        amount: amount
                    });
                    console.log(`[Server] Emitted horse_race:drinks_received to ${playerToReceive.name} (Socket: ${playerToReceive.id})`);
                }
            }
        }

        // Check if all unique winners have distributed their drinks
        const uniqueWinners = new Set(gameState.winners.map(w => w.uuid));
        const allWinnersDistributed = Array.from(uniqueWinners).every(uuid => 
            gameState.winnersDistributedDrinks.includes(uuid)
        );

        if (allWinnersDistributed) {
            gameState.phase = 'finished';
        }

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('disconnecting', async () => {
        // (clon) Antes se echaba al jugador al instante: al recargar la página perdía
        // sus cartas, tragos, apuestas y hasta descuadraba el turno. Ahora se marca
        // como desconectado y solo se le quita si no vuelve en PLAYER_GRACE_SECONDS.
        for (const roomId of socket.rooms) {
            if (roomId === socket.id) continue;
            try {
                const room = await db.getRoomById(roomId);
                if (!room) continue;
                let gameState = await db.getGameState(roomId);
                if (!gameState || !gameState.players) continue;
                const player = gameState.players.find(p => p.id === socket.id);
                if (!player) continue;
                player.online = false;
                await db.updateGameState(roomId, gameState);
                console.log(`[Server] ${player.name} (${player.uuid}) se ha desconectado de ${roomId}. Margen de ${PLAYER_GRACE_SECONDS}s para volver.`);
                const stateToSend = getSanitizedGameState(gameState);
                stateToSend.roomAdminId = room.creatorId;
                io.to(roomId).emit('roomState', stateToSend);
                if (room.gameType !== 'imitador') schedulePlayerRemoval(roomId, player.uuid, socket.id);
            } catch (err) {
                console.error('[Server] Error al desconectar:', err.message);
            }
        }
    });

    socket.on('roulette:sendDrinks', async ({ roomId, senderUuid, targetUuid, drinkCount }) => {
        console.log(`[Server] Received 'roulette:sendDrinks' event:`, { roomId, senderUuid, targetUuid, drinkCount }); // DEBUG LOG
        const room = await db.getRoomById(roomId);
        if (!room || room.gameType !== 'roulette') {
            console.log('[Server] Room not found or wrong game type.'); // DEBUG LOG
            return;
        }
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'distributing') {
            console.log(`[Server] Wrong game phase: ${gameState.phase}`); // DEBUG LOG
            return;
        }

        const sender = gameState.players.find(p => p.uuid === senderUuid);
        const target = gameState.players.find(p => p.uuid === targetUuid);
        
        if (!sender || !target) {
            console.log('[Server] Sender or target not found.'); // DEBUG LOG
            return;
        }
        
        const totalCost = drinkCount * gameState.settings.drinkPrice;
        if (sender.sips < totalCost) {
            console.log(`[Server] Sender has insufficient sips. Has ${sender.sips}, needs ${totalCost}`); // DEBUG LOG
            return; // Not enough points
        }
        
        // Check if sender won this round
        const isWinner = gameState.winners.some(w => w.uuid === senderUuid);
        if (!isWinner) {
            console.log('[Server] Sender is not a winner of the round.'); // DEBUG LOG
            return; // Only winners can distribute
        }
        
        sender.sips -= totalCost;
        console.log(`[Server] Deduced ${totalCost} from ${sender.name}. New balance: ${sender.sips}`); // DEBUG LOG

        // Emit drinks received to target
        io.to(target.id).emit('roulette:drinksReceived', {
            from: sender.name,
            amount: drinkCount
        });
        
        // Update game state
        await db.updateGameState(roomId, gameState);
        io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
    });

    socket.on('roulette:clearBets', async ({ roomId, user }) => {
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'betting') return;

        const player = gameState.players.find(p => p.uuid === user.uuid);
        const playerBets = gameState.bets[user.uuid];

        if (player && playerBets) {
            const totalBetAmount = playerBets.reduce((acc, b) => acc + b.amount, 0);
            player.sips += totalBetAmount;

            delete gameState.bets[user.uuid];

            await db.updateGameState(roomId, gameState);
            io.to(roomId).emit('roomState', getSanitizedGameState(gameState));
        }
    });

    socket.on('start-autobus', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.players.length < 1 || gameState.phase !== 'waiting') return; // At least 1 player to start

        console.log(`[Server] Iniciando El Autobús en la sala ${roomId}`);
        gameState.phase = 'red-or-black';
        gameState.deck = shuffleDeck(createPokerDeck());
        gameState.currentPlayerIndex = 0;
        gameState.players.forEach(p => {
            p.currentCards = [];
            p.drinksToTake = 0;
            p.totalDrinks = 0; // Initialize total drinks
            p.hasWon = false;
            p.message = ''; // Initialize player-specific message
        });

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('autobus:red-or-black', async ({ roomId, userId, guess }) => {
        const room = await db.getRoomById(roomId);
        if (!room) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'red-or-black') return;

        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        if (currentPlayer.uuid !== userId) return; // Not current player's turn

        const drawnCard = drawAutobusCard(gameState);
        gameState.currentCard = drawnCard;

        const isRed = drawnCard.suit === 'hearts' || drawnCard.suit === 'diamonds';
        const correctGuess = (guess === 'red' && isRed) || (guess === 'black' && !isRed);

        if (correctGuess) {
            currentPlayer.currentCards.push(drawnCard);
            currentPlayer.message = '¡Correcto!';
        } else {
            currentPlayer.drinksToTake = 1;
            currentPlayer.totalDrinks += 1; // Increment total drinks
            currentPlayer.message = 'Has fallado, bebes 1 trago.';
        }

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);

        setTimeout(async () => {
            let updatedGameState = await db.getGameState(roomId);
            if (!updatedGameState) return;

            if (correctGuess) {
                updatedGameState.phase = 'higher-or-lower';
                // Message for correct guess clears after 3 seconds
                updatedGameState.players[updatedGameState.currentPlayerIndex].message = ''; 
            } else {
                updatedGameState.players[updatedGameState.currentPlayerIndex].currentCards = [];
                // Advance to next player
                let nextPlayerIndex = (updatedGameState.currentPlayerIndex + 1) % updatedGameState.players.length;
                while (updatedGameState.players[nextPlayerIndex].hasWon && updatedGameState.players.filter(p => !p.hasWon).length > 0) {
                    nextPlayerIndex = (nextPlayerIndex + 1) % updatedGameState.players.length;
                }
                updatedGameState.currentPlayerIndex = nextPlayerIndex;
                // Clear message for the new current player whose turn is starting
                updatedGameState.players[updatedGameState.currentPlayerIndex].message = ''; 
                updatedGameState.phase = 'red-or-black';
            }
            updatedGameState.currentCard = null; // Hide card after 3 seconds

            await db.updateGameState(roomId, updatedGameState);
            const updatedStateToSend = getSanitizedGameState(updatedGameState);
            updatedStateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', updatedStateToSend);
        }, 3000);
    });

    socket.on('autobus:higher-or-lower', async ({ roomId, userId, guess }) => {
        const room = await db.getRoomById(roomId);
        if (!room) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'higher-or-lower') return;

        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.uuid !== userId) return; // Not current player's turn
        
        // Safety check for cards
        if (!currentPlayer.currentCards) currentPlayer.currentCards = [];
        if (currentPlayer.currentCards.length === 0) {
            console.log(`[Server] Player ${userId} has no cards in higher-or-lower phase. Recovery needed.`);
            // If they have no cards, we might need to give them one or skip
            return;
        }

        const lastCard = currentPlayer.currentCards[currentPlayer.currentCards.length - 1];
        const drawnCard = drawAutobusCard(gameState);
        if (!drawnCard) return; // Deck empty case
        gameState.currentCard = drawnCard;

        const rankValues = {'2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14};
        const lastCardValue = rankValues[lastCard.rank];
        const drawnCardValue = rankValues[drawnCard.rank];

        let correctGuess = false;
        if (guess === 'higher' && drawnCardValue > lastCardValue) {
            correctGuess = true;
        } else if (guess === 'lower' && drawnCardValue < lastCardValue) {
            correctGuess = true;
        }

        if (correctGuess) {
            currentPlayer.currentCards.push(drawnCard);
            currentPlayer.message = '¡Correcto!';
        } else {
            currentPlayer.drinksToTake = 2;
            currentPlayer.totalDrinks += 2; // Increment total drinks
            currentPlayer.message = 'Has fallado, bebes 2 tragos.';
        }

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);

        setTimeout(async () => {
            let updatedGameState = await db.getGameState(roomId);
            if (!updatedGameState) return;

            if (correctGuess) {
                updatedGameState.phase = 'inside-or-outside';
                // Message for correct guess clears after 3 seconds
                updatedGameState.players[updatedGameState.currentPlayerIndex].message = ''; 
            } else {
                updatedGameState.players[updatedGameState.currentPlayerIndex].currentCards = [];
                // Advance to next player
                let nextPlayerIndex = (updatedGameState.currentPlayerIndex + 1) % updatedGameState.players.length;
                while (updatedGameState.players[nextPlayerIndex].hasWon && updatedGameState.players.filter(p => !p.hasWon).length > 0) {
                    nextPlayerIndex = (nextPlayerIndex + 1) % updatedGameState.players.length;
                }
                updatedGameState.currentPlayerIndex = nextPlayerIndex;
                // Clear message for the new current player whose turn is starting
                updatedGameState.players[updatedGameState.currentPlayerIndex].message = ''; 
                updatedGameState.phase = 'red-or-black';
            }
            updatedGameState.currentCard = null;

            await db.updateGameState(roomId, updatedGameState);
            const updatedStateToSend = getSanitizedGameState(updatedGameState);
            updatedStateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', updatedStateToSend);
        }, 3000);
    });

    socket.on('autobus:inside-or-outside', async ({ roomId, userId, guess }) => {
        const room = await db.getRoomById(roomId);
        if (!room) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'inside-or-outside') return;

        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.uuid !== userId) return; // Not current player's turn
        
        if (!currentPlayer.currentCards) currentPlayer.currentCards = [];
        if (currentPlayer.currentCards.length < 2) {
            console.log(`[Server] Player ${userId} has insufficient cards for inside-or-outside phase.`);
            return;
        }

        const card1 = currentPlayer.currentCards[0];
        const card2 = currentPlayer.currentCards[1];
        const drawnCard = drawAutobusCard(gameState);
        gameState.currentCard = drawnCard;

        const rankValues = {'2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14};
        const card1Value = rankValues[card1.rank];
        const card2Value = rankValues[card2.rank];
        const drawnCardValue = rankValues[drawnCard.rank];

        const min = Math.min(card1Value, card2Value);
        const max = Math.max(card1Value, card2Value);

        let correctGuess = false;
        if (guess === 'inside' && drawnCardValue > min && drawnCardValue < max) {
            correctGuess = true;
        } else if (guess === 'outside' && (drawnCardValue < min || drawnCardValue > max)) {
            correctGuess = true;
        }

        if (correctGuess) {
            currentPlayer.currentCards.push(drawnCard);
            currentPlayer.message = '¡Correcto!';
        } else {
            currentPlayer.drinksToTake = 3;
            currentPlayer.totalDrinks += 3; // Increment total drinks
            currentPlayer.message = 'Has fallado, bebes 3 tragos.';
        }

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);

        setTimeout(async () => {
            let updatedGameState = await db.getGameState(roomId);
            if (!updatedGameState) return;

            if (correctGuess) {
                updatedGameState.phase = 'suit-guess';
                // Message for correct guess clears after 3 seconds
                updatedGameState.players[updatedGameState.currentPlayerIndex].message = ''; 
            } else {
                updatedGameState.players[updatedGameState.currentPlayerIndex].currentCards = [];
                // Advance to next player
                let nextPlayerIndex = (updatedGameState.currentPlayerIndex + 1) % updatedGameState.players.length;
                while (updatedGameState.players[nextPlayerIndex].hasWon && updatedGameState.players.filter(p => !p.hasWon).length > 0) {
                    nextPlayerIndex = (nextPlayerIndex + 1) % updatedGameState.players.length;
                }
                updatedGameState.currentPlayerIndex = nextPlayerIndex;
                // Clear message for the new current player whose turn is starting
                updatedGameState.players[updatedGameState.currentPlayerIndex].message = ''; 
                updatedGameState.phase = 'red-or-black';
            }
            updatedGameState.currentCard = null;

            await db.updateGameState(roomId, updatedGameState);
            const updatedStateToSend = getSanitizedGameState(updatedGameState);
            updatedStateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', updatedStateToSend);
        }, 3000);
    });

    socket.on('autobus:suit-guess', async ({ roomId, userId, guess }) => {
        const room = await db.getRoomById(roomId);
        if (!room) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'suit-guess') return;

        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        if (!currentPlayer || currentPlayer.uuid !== userId) return; // Not current player's turn
        
        if (!currentPlayer.currentCards) currentPlayer.currentCards = [];
        if (currentPlayer.currentCards.length < 3) {
            console.log(`[Server] Player ${userId} has insufficient cards for suit-guess phase.`);
            return;
        }

        const drawnCard = drawAutobusCard(gameState);
        gameState.currentCard = drawnCard;

        let correctGuess = false;
        if (drawnCard.suit === guess) {
            correctGuess = true;
        }

        if (correctGuess) {
            currentPlayer.currentCards.push(drawnCard);
            currentPlayer.hasWon = true;
            currentPlayer.message = '¡Has ganado el autobús!';
        } else {
            currentPlayer.drinksToTake = 4;
            currentPlayer.totalDrinks += 4; // Increment total drinks
            currentPlayer.message = 'Has fallado, bebes 4 tragos.';
        }

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);

        setTimeout(async () => {
            let updatedGameState = await db.getGameState(roomId);
            if (!updatedGameState) return;

            if (!correctGuess) {
                updatedGameState.players[updatedGameState.currentPlayerIndex].currentCards = [];
            }

            // Advance to next player
            let nextPlayerIndex = (updatedGameState.currentPlayerIndex + 1) % updatedGameState.players.length;
            // Skip players who have won
            let activePlayers = updatedGameState.players.filter(p => !p.hasWon);
            if (activePlayers.length === 0) {
                updatedGameState.phase = 'finished';
            } else {
                while (updatedGameState.players[nextPlayerIndex].hasWon) {
                    nextPlayerIndex = (nextPlayerIndex + 1) % updatedGameState.players.length;
                }
                updatedGameState.currentPlayerIndex = nextPlayerIndex;
                updatedGameState.players[updatedGameState.currentPlayerIndex].message = ''; // Clear message for the new current player
                updatedGameState.phase = 'red-or-black';
            }
            updatedGameState.currentCard = null;

            await db.updateGameState(roomId, updatedGameState);
            const updatedStateToSend = getSanitizedGameState(updatedGameState);
            updatedStateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', updatedStateToSend);
        }, 3000);
    });

    socket.on('imitador:startGame', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState) return; // Allow if 'waiting' OR 'playing'

        if (gameState.players.length < 4) {
            // UI already prevents this, but server-side check for safety
            return;
        }

        console.log(`[Server] Iniciando/Repartiendo Imitador en la sala ${roomId}`);
        
        // Shuffle players
        const shuffled = [...gameState.players];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        gameState.assignments = {};
        for (let i = 0; i < shuffled.length; i++) {
            const imitator = shuffled[i];
            const target = shuffled[(i + 1) % shuffled.length]; // Circular assignment
            gameState.assignments[imitator.uuid] = target.uuid;
        }

        gameState.phase = 'playing';

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('imitador:resetGame', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState) return;

        console.log(`[Server] Reiniciando Imitador en la sala ${roomId}`);

        const originalSettings = gameState.settings;
        const originalPlayers = gameState.players; // Keep players

        let newGameState = createImitadorState(originalSettings);
        newGameState.players = originalPlayers;

        await db.updateGameState(roomId, newGameState);
        const stateToSend = getSanitizedGameState(newGameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('bolita:startGame', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'waiting' || gameState.players.length === 0) return;

        console.log(`[Server] Iniciando La Bolita en la sala ${roomId}`);

        // 1. Reorder players randomly
        gameState.turnOrder = gameState.players.map(p => p.uuid).sort(() => Math.random() - 0.5);
        gameState.currentPlayerIndex = 0;

        // 2. Generate round obstacles and prizes
        regenerateBolitaRound(gameState);
        gameState.phase = 'playing';

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('bolita:dropBall', async ({ roomId, userId, startX }) => {
        const room = await db.getRoomById(roomId);
        if (!room) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'playing') return;

        // Verify turn
        const currentPlayerUuid = gameState.turnOrder[gameState.currentPlayerIndex];
        if (currentPlayerUuid !== userId) return;

        // Verify ball is not dropping
        if (gameState.ballState.dropping) return;

        console.log(`[Server] Drop ball in Room ${roomId} at X=${startX} by User ${userId}`);

        // 1. Run physics simulation to get path and landing hole
        const { path, finalHole } = simulateBallDrop(startX, gameState.pegs);
        const reward = gameState.prizes[finalHole];

        gameState.ballState = {
            dropping: true,
            path: path,
            startX: startX,
            finalHole: finalHole,
            reward: reward
        };

        await db.updateGameState(roomId, gameState);
        let stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);

        // 2. Clear any existing timer for this room
        if (activeGameIntervals[roomId]) {
            clearTimeout(activeGameIntervals[roomId]);
        }

        // 3. Set a timer to transition turn after ball lands and reward modal completes
        const animationTime = path.length * 16.67;
        const rewardDisplayTime = 3000;
        const totalDuration = animationTime + rewardDisplayTime;

        activeGameIntervals[roomId] = setTimeout(async () => {
            delete activeGameIntervals[roomId];
            
            let updatedGameState = await db.getGameState(roomId);
            if (!updatedGameState || updatedGameState.phase !== 'playing') return;

            const player = updatedGameState.players.find(p => p.uuid === currentPlayerUuid);

            // Record last action
            updatedGameState.lastAction = {
                playerName: player ? player.name : 'Jugador',
                reward: updatedGameState.ballState.reward
            };

            // Advance turn
            updatedGameState.currentPlayerIndex = (updatedGameState.currentPlayerIndex + 1) % updatedGameState.turnOrder.length;

            // Generate new board pegs & prizes for next turn
            regenerateBolitaRound(updatedGameState);

            await db.updateGameState(roomId, updatedGameState);
            let nextStateToSend = getSanitizedGameState(updatedGameState);
            nextStateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', nextStateToSend);
        }, totalDuration);
    });

    socket.on('bolita:resetGame', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState) return;

        console.log(`[Server] Reiniciando La Bolita en la sala ${roomId}`);

        if (activeGameIntervals[roomId]) {
            clearTimeout(activeGameIntervals[roomId]);
            delete activeGameIntervals[roomId];
        }

        const originalSettings = gameState.settings;
        const originalPlayers = gameState.players;

        let newGameState = createBolitaState(originalSettings);
        newGameState.players = originalPlayers;

        await db.updateGameState(roomId, newGameState);
        const stateToSend = getSanitizedGameState(newGameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('cofres:startGame', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'waiting' || gameState.players.length === 0) return;

        console.log(`[Server] Iniciando Cofres del Tesoro en la sala ${roomId}`);
        
        // 1. Reorder players randomly
        gameState.turnOrder = gameState.players.map(p => p.uuid).sort(() => Math.random() - 0.5);
        gameState.currentPlayerIndex = 0;
        
        // 2. Generate chests
        const numChests = gameState.settings.numChests;
        
        const prizeTypes = [
            ...[1, 2, 3, 4, 5].map(n => ({ type: 'BEBE', value: n })),
            ...[1, 2, 3, 4, 5].map(n => ({ type: 'REPARTE', value: n })),
            { type: 'ACABATE' },
            { type: 'MANDA_ACABAR' }
        ];

        const rewards = [];
        for (let i = 0; i < numChests; i++) {
            rewards.push(prizeTypes[Math.floor(Math.random() * prizeTypes.length)]);
        }
        
        const chests = [];
        const goldenCount = Math.floor(Math.random() * 2) + 1; // 1 or 2
        const largeCount = 2; // Fixed 2 large chests
        const normalCount = Math.max(0, numChests - goldenCount - largeCount);

        for (let i = 0; i < normalCount; i++) chests.push({ type: 'normal' });
        for (let i = 0; i < largeCount; i++) chests.push({ type: 'large' });
        for (let i = 0; i < goldenCount; i++) chests.push({ type: 'golden' });

        // Shuffle chests
        chests.sort(() => Math.random() - 0.5);

        // Position chests in a 0-100 normalized space
        const placed = [];
        for (let i = 0; i < chests.length; i++) {
            const chest = chests[i];
            chest.reward = rewards[i] || prizeTypes[0];
            chest.opened = false;
            chest.id = i;

            // Normalized sizes (approx % of container)
            const size = (chest.type === 'large') ? 14 : 10;
            const buffer = 2;

            let found = false;
            let attempts = 0;
            while (!found && attempts < 1000) {
                const x = Math.random() * (100 - size - 4) + 2;
                const y = Math.random() * (100 - size - 4) + 2;

                const collision = placed.some(p => {
                    return !(x + size + buffer < p.x ||
                             x > p.x + p.size + buffer ||
                             y + size + buffer < p.y ||
                             y > p.y + p.size + buffer);
                });

                if (!collision) {
                    chest.x = x;
                    chest.y = y;
                    chest.size = size;
                    placed.push({ x, y, size });
                    found = true;
                }
                attempts++;
            }
            // If not found after 1000 attempts, just place it (should be rare with 15-50 chests)
            if (!found) {
                chest.x = Math.random() * 80 + 10;
                chest.y = Math.random() * 80 + 10;
            }
        }

        gameState.chests = chests;
        gameState.phase = 'playing';

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('cofres:openChest', async ({ roomId, userId, chestId }) => {
        const room = await db.getRoomById(roomId);
        if (!room) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState || gameState.phase !== 'playing') return;

        const currentPlayerUuid = gameState.turnOrder[gameState.currentPlayerIndex];
        if (currentPlayerUuid !== userId) return;

        const chest = gameState.chests.find(c => c.id === chestId);
        if (!chest || chest.opened) return;

        chest.opened = true;
        const player = gameState.players.find(p => p.uuid === userId);
        gameState.lastAction = {
            playerName: player.name,
            reward: chest.reward,
            chestType: chest.type
        };

        const allOpened = gameState.chests.every(c => c.opened);
        if (allOpened) {
            gameState.phase = 'finished';
        } else {
            gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.turnOrder.length;
        }

        await db.updateGameState(roomId, gameState);
        const stateToSend = getSanitizedGameState(gameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('cofres:resetGame', async ({ roomId, userId }) => {
        const room = await db.getRoomById(roomId);
        if (!room || room.creatorId !== userId) return;
        let gameState = await db.getGameState(roomId);
        if (!gameState) return;

        const originalSettings = gameState.settings;
        const originalPlayers = gameState.players;

        let newGameState = createCofresState(originalSettings);
        newGameState.players = originalPlayers;

        await db.updateGameState(roomId, newGameState);
        const stateToSend = getSanitizedGameState(newGameState);
        stateToSend.roomAdminId = room.creatorId;
        io.to(roomId).emit('roomState', stateToSend);
    });

    socket.on('disconnect', () => {
        console.log(`[Server] Usuario desconectado: ${socket.id}`);
    });
});

// Intervalo de actualización periódica de usuarios activos para el Dashboard (cada 3 segundos)
setInterval(async () => {
    try {
        const dashboardRoom = io.sockets.adapter.rooms.get('analytics_dashboard');
        if (dashboardRoom && dashboardRoom.size > 0) {
            const active = await analyticsDb.getActiveUsers(db.pool);
            io.to('analytics_dashboard').emit('analytics:active_count', active.count);
        }
    } catch (err) {
        // Silenciar errores en segundo plano
    }
}, 3000);
// =====================================================================
// (clon) Limpieza de salas vacías.
// Cada 30 s se mira cuánta gente hay CONECTADA de verdad en cada sala (sockets),
// no la lista de jugadores (que puede quedarse con gente desconectada).
// Si una sala lleva ROOM_EMPTY_MINUTES (por defecto 2) sin nadie, se borra
// junto con su estado y se paran sus temporizadores. Cubre también salas creadas
// a las que nunca entró nadie, que antes se quedaban para siempre en la lista.
// =====================================================================
const ROOM_EMPTY_MINUTES = Number(process.env.ROOM_EMPTY_MINUTES) || 2;
const roomEmptySince = {};
async function deleteRoomCompletely(roomId) {
    [activeGameIntervals[roomId], lamenteTimeouts[roomId], activeGameIntervals[`deleteTimer_${roomId}`]].forEach(t => { if (t) { clearTimeout(t); clearInterval(t); } });
    delete activeGameIntervals[roomId]; delete lamenteTimeouts[roomId]; delete activeGameIntervals[`deleteTimer_${roomId}`];
    await db.deleteGameState(roomId);
    await db.deleteRoom(roomId);
    io.emit('roomListUpdate');
}
setInterval(async () => {
    try {
        const rooms = await db.getAllRooms();
        const now = Date.now();
        const alive = new Set();
        for (const room of rooms) {
            alive.add(room.id);
            const sockets = io.sockets.adapter.rooms.get(room.id);
            if (sockets && sockets.size > 0) { delete roomEmptySince[room.id]; continue; }
            if (!roomEmptySince[room.id]) { roomEmptySince[room.id] = now; continue; }
            if (now - roomEmptySince[room.id] >= ROOM_EMPTY_MINUTES * 60 * 1000) {
                console.log(`[Server] Sala ${room.id} (${room.gameType}) vacía ${ROOM_EMPTY_MINUTES} min: se borra.`);
                delete roomEmptySince[room.id];
                await deleteRoomCompletely(room.id);
            }
        }
        for (const id in roomEmptySince) if (!alive.has(id)) delete roomEmptySince[id];
    } catch (err) {
        console.error('[Server] Error limpiando salas vacías:', err.message);
    }
}, 30 * 1000);

// (clon) red de seguridad: un error dentro de un evento de socket no debe tumbar el servidor entero (y todas las salas)
process.on('unhandledRejection', (err) => {
    console.error('[Server] Error no controlado (la partida sigue):', err && err.stack || err);
});

// =====================================================================
// (clon) Jugadores que se desconectan
// =====================================================================
const PLAYER_GRACE_SECONDS = Number(process.env.PLAYER_GRACE_SECONDS) || 120; // margen para bloquear el móvil un rato sin que te echen
const pendingRemovals = {};
let pyramidRoundCheck = null; // se asigna dentro de io.on (usa la misma lógica de fin de ronda)

function cancelPendingRemoval(roomId, uuid) {
    const key = `${roomId}:${uuid}`;
    if (pendingRemovals[key]) { clearTimeout(pendingRemovals[key]); delete pendingRemovals[key]; }
}

function schedulePlayerRemoval(roomId, uuid, socketId) {
    cancelPendingRemoval(roomId, uuid);
    const key = `${roomId}:${uuid}`;
    pendingRemovals[key] = setTimeout(async () => {
        delete pendingRemovals[key];
        try {
            const room = await db.getRoomById(roomId);
            const gameState = room && await db.getGameState(roomId);
            if (!gameState || !gameState.players) return;
            const player = gameState.players.find(p => p.uuid === uuid);
            // Ha vuelto (otro socket) o ya no está: nada que hacer
            if (!player || player.online !== false || player.id !== socketId) return;
            // La bolita está cayendo: esperar a que termine la tirada
            if (gameState.ballState && gameState.ballState.dropping) return schedulePlayerRemoval(roomId, uuid, socketId);
            removePlayerFromState(gameState, uuid);
            await db.updateGameState(roomId, gameState);
            if (gameState.game === 'pyramid' && gameState.phase === 'playing' && gameState.players.length && pyramidRoundCheck) {
                await pyramidRoundCheck(roomId);
            }
            console.log(`[Server] ${player.name} no ha vuelto a ${roomId}: sale de la partida. Quedan ${gameState.players.length}.`);
            const stateToSend = getSanitizedGameState(gameState);
            stateToSend.roomAdminId = room.creatorId;
            io.to(roomId).emit('roomState', stateToSend);
        } catch (err) {
            console.error('[Server] Error quitando jugador:', err.message);
        }
    }, PLAYER_GRACE_SECONDS * 1000);
}

// Quita al jugador y deja el turno bien puesto (antes podía quedarse apuntando a nadie y la partida se colgaba)
function removePlayerFromState(gs, uuid) {
    const idx = gs.players.findIndex(p => p.uuid === uuid);
    if (idx === -1) return false;
    const playing = gs.phase && gs.phase !== 'waiting' && gs.phase !== 'finished';
    gs.players.splice(idx, 1);
    if (gs.game === 'autobus') {
        if (!gs.players.length) { gs.currentPlayerIndex = 0; return true; }
        if (idx < gs.currentPlayerIndex) {
            gs.currentPlayerIndex--;
        } else if (idx === gs.currentPlayerIndex) {
            gs.currentPlayerIndex = gs.currentPlayerIndex % gs.players.length;
            if (playing) {
                let tries = 0;
                while (gs.players[gs.currentPlayerIndex].hasWon && tries++ < gs.players.length) {
                    gs.currentPlayerIndex = (gs.currentPlayerIndex + 1) % gs.players.length;
                }
                const next = gs.players[gs.currentPlayerIndex];
                next.currentCards = []; next.message = '';
                gs.currentCard = null;
                gs.phase = 'red-or-black';
            }
        }
        if (playing && gs.players.every(p => p.hasWon)) gs.phase = 'finished';
    } else if (Array.isArray(gs.turnOrder)) {
        const t = gs.turnOrder.indexOf(uuid);
        if (t !== -1) {
            gs.turnOrder.splice(t, 1);
            if (!gs.turnOrder.length) gs.currentPlayerIndex = 0;
            else {
                if (t < gs.currentPlayerIndex) gs.currentPlayerIndex--;
                gs.currentPlayerIndex = gs.currentPlayerIndex % gs.turnOrder.length;
            }
        }
    }
    return true;
}

// El Autobús: si se acaba la baraja se vuelve a barajar (antes el servidor fallaba al robar de un mazo vacío)
function drawAutobusCard(gs) {
    if (!gs.deck || !gs.deck.length) gs.deck = shuffleDeck(createPokerDeck());
    return gs.deck.pop();
}
