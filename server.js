require('dotenv').config({ quiet: true }); // Load environment variables from .env file and suppress logs

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const activeGameIntervals = {}; // To store setInterval IDs for active games
const lamenteTimeouts = {}; // To store setInterval IDs for La Mente game countdowns
const db = require('./db'); // Import the database module

const app = express();
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

function getSanitizedGameState(gameState) {
    const stateToSend = { ...gameState };
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
        await endRace(roomId, gameType, drawnCard.suit);
        // endRace already handles persistence and emission
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
    if (!gameState) return;

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
    }, currentState.settings.resultTime * 1000);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/sitemap.xml', (req, res) => {
    const baseUrl = 'https://juegosbeber.es';
    const gameTypes = ['horse-race', 'voting', 'roulette', 'pyramid', 'autobus', 'lamente', 'imitador'];
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    
    // Static pages
    xml += `<url><loc>${baseUrl}/</loc><priority>1.0</priority><changefreq>weekly</changefreq></url>`;
    xml += `<url><loc>${baseUrl}/privacy</loc><priority>0.5</priority><changefreq>yearly</changefreq></url>`;
    xml += `<url><loc>${baseUrl}/terms</loc><priority>0.5</priority><changefreq>yearly</changefreq></url>`;
    
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

app.get('/rooms/:gameType', async (req, res) => {
    const { gameType } = req.params;

    const gameTypeNames = {
        'horse-race': 'Carrera de Caballos',
        'voting': 'Votaciones',
        'roulette': 'Ruleta',
        'pyramid': 'La Pirámide',
        'autobus': 'El Autobús',
        'lamente': 'La Mente',
        'imitador': 'El Imitador'
    };
    
    const gameDescriptions = {
        'horse-race': 'Compite en una emocionante carrera de caballos con cartas. Apuesta tus sorbos y deja que el azar decida quién bebe.',
        'voting': 'Descubre qué piensan tus amigos de ti con el juego de las votaciones. ¿Quién es más probable que...?',
        'roulette': 'Gira la ruleta de la suerte y reparte tragos entre los perdedores. Un clásico de casino adaptado para fiestas.',
        'pyramid': 'El juego de cartas de la Pirámide: memoria y faroleo para hacer beber a tus amigos.',
        'autobus': '¿Podrás bajarte del autobús? Adivina las cartas y evita acumular tragos en este juego de pura tensión.',
        'lamente': 'Un reto cooperativo de sincronización mental. Juega tus cartas en orden sin hablar.',
        'imitador': 'Imita a tus amigos y trata de que no te pillen. El juego de risas y personificación definitivo.'
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
        title: `Salas de ${prettyGameName} - JuegosBeber.es`, 
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
        'imitador': 'El Imitador'
    };
    const prettyGameName = gameTypeNames[gameType] || gameType;
    
    res.render(view, { 
        title: `Jugando a ${prettyGameName} - JuegosBeber.es`, 
        gameType, 
        roomId, 
        players: players,
        description: `Disfruta de ${prettyGameName} online con tus amigos. La mejor experiencia de juegos beber en tiempo real.`
    });
});

app.get('/admin/:gameType', (req, res) => {
    const { gameType } = req.params;

    const gameTitles = {
        'horse-race': 'Crear Carrera de Caballos - JuegosBeber.es',
        'voting': 'Crear Votación - JuegosBeber.es',
        'roulette': 'Configurar Ruleta - JuegosBeber.es',
        'pyramid': 'Crear Sala de Pirámide - JuegosBeber.es',
        'autobus': 'Crear Sala de El Autobús - JuegosBeber.es',
        'lamente': 'Crear Sala de La Mente - JuegosBeber.es',
        'imitador': 'Crear Sala de El Imitador - JuegosBeber.es'
    };
    
    const gameDescriptions = {
        'horse-race': 'Configura tu propia carrera de caballos y desafía a tus amigos.',
        'voting': 'Crea una votación personalizada y descubre la verdad sobre tus amigos.',
        'roulette': 'Ajusta los puntos y premios de tu ruleta personalizada.',
        'pyramid': 'Elige los niveles de dificultad de tu pirámide de cartas.',
        'autobus': 'Prepara el autobús para tus amigos. ¡Que no se queden arriba!',
        'lamente': 'Configura el rango de números para el desafío mental.',
        'imitador': 'Crea una sala de imitaciones y risas aseguradas.'
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

const { exec } = require('child_process');

app.post('/restart', (req, res) => {
    console.log('[Server] Recibida solicitud de reinicio...');
    exec('pm2 restart 11', (error, stdout, stderr) => {
        if (error) {
            console.error(`[Server] Error al reiniciar: ${error.message}`);
            return res.status(500).send('Error al reiniciar el servidor.');
        }
        if (stderr) {
            console.error(`[Server] Stderr al reiniciar: ${stderr}`);
        }
        console.log(`[Server] Stdout al reiniciar: ${stdout}`);
        res.status(200).send('OK');
    });
});

io.on('connection', (socket) => {
    console.log(`[Server] Usuario conectado: ${socket.id}`);

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
                gameState.players.push(player);
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

        const deck = shuffleDeck(createDeck());

        gameState.playerHands = {};
        gameState.players.forEach(player => {
            gameState.playerHands[player.uuid] = [
                { card: deck.pop(), used: false },
                { card: deck.pop(), used: false }
            ];
        });

        gameState.pyramid = [];
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

        if (gameState.playersFinishedThisRound.length >= gameState.players.length) {
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
        const usedCardsCount = senderHand.filter(c => c.used).length;
        if (usedCardsCount >= 2) return; // Already used all cards

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
        const pyramidCard = gameState.pyramid.flat()[gameState.currentCardIndex - 1].card;
        const level = gameState.pyramid.findIndex(row => row.some(c => c.card === pyramidCard)) + 1;
        
        let drinks = 0;
        let drinkerUuid = null;
        let drinkerName = null;
        let toastMessage = '';

        if (resolution === 'accept') {
            drinks = level;
            drinkerUuid = target.uuid;
            drinkerName = target.name;
            toastMessage = `${target.name} acepta y bebe ${drinks} trago(s).`;
            gameState.actionLog.push(toastMessage);
        } else if (resolution === 'challenge') {
            const senderCard = gameState.playerHands[sender.uuid][action.handCardIndex].card;
            const senderCardName = `${senderCard.number} de ${senderCard.suit}`;
            gameState.actionLog.push(`${target.name} desafía! La carta de ${sender.name} era un ${senderCardName}.`);
            drinks = level * 2;
            if (senderCard.suit === pyramidCard.suit) {
                drinkerUuid = target.uuid;
                drinkerName = target.name;
                toastMessage = `¡Desafío perdido! ${target.name} bebe ${drinks} tragos.`;
                gameState.actionLog.push(toastMessage);
            } else {
                drinkerUuid = sender.uuid;
                drinkerName = sender.name;
                toastMessage = `¡Desafío ganado! ${sender.name} bebe ${drinks} tragos.`;
                gameState.actionLog.push(toastMessage);
            }
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
            const originalPlayers = gameState.players.map(p => ({ uuid: p.uuid, name: p.name, id: p.id }));
            gameState = createAutobusState();
            gameState.players = originalPlayers.map(p => ({ ...p, totalDrinks: 0 })); // Reset total drinks
            
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
        for (const roomId of socket.rooms) {
            if (roomId === socket.id) continue; // Skip the socket's own ID room

            const room = await db.getRoomById(roomId);
            if (!room) continue;

            let gameState = await db.getGameState(roomId);
            if (!gameState || !gameState.players) continue;

            if (room.gameType === 'imitador') {
                const player = gameState.players.find(p => p.id === socket.id);
                if (player) {
                    player.online = false;
                    await db.updateGameState(roomId, gameState);
                    console.log(`[Server] Player ${player.name} (${player.uuid}) marked as offline in Imitador room ${roomId}`);

                    // Check if ALL players are offline to schedule cleanup
                    const allOffline = gameState.players.every(p => p.online === false);
                    if (allOffline) {
                        console.log(`[Server] Sala Imitador ${roomId} vacía (todos offline). Programando borrado en 2 minutos.`);
                        activeGameIntervals[`deleteTimer_${roomId}`] = setTimeout(async () => {
                             let currentGameState = await db.getGameState(roomId);
                             // Re-check all offline
                             if (currentGameState && currentGameState.players.every(p => p.online === false)) {
                                 console.log(`[Server] Borrando sala Imitador vacía: ${roomId}`);
                                 await db.deleteGameState(roomId);
                                 await db.deleteRoom(roomId);
                                 io.emit('roomListUpdate');
                             }
                             delete activeGameIntervals[`deleteTimer_${roomId}`];
                        }, 2 * 60 * 1000);
                    }
                }
                continue; // Skip removal for imitador
            }

            const initialPlayerCount = gameState.players.length;
            gameState.players = gameState.players.filter(p => p.id !== socket.id);

            if (gameState.players.length !== initialPlayerCount) { // Only update if a player was actually removed
                await db.updateGameState(roomId, gameState);
                console.log(`[Server] Usuario ${socket.id} ha salido de la sala ${roomId}. Jugadores restantes: ${gameState.players.length}`);

                if (gameState.players.length === 0) {
                    console.log(`[Server] La sala ${roomId} está vacía. Programando borrado en 2 minutos.`);
                    // Store the timeout ID in a temporary in-memory map
                    activeGameIntervals[`deleteTimer_${roomId}`] = setTimeout(async () => {
                        let currentGameState = await db.getGameState(roomId);
                        if (currentGameState && currentGameState.players.length === 0) {
                            console.log(`[Server] Borrando sala vacía: ${roomId}`);
                            await db.deleteGameState(roomId);
                            await db.deleteRoom(roomId);
                            io.emit('roomListUpdate'); // A generic event to trigger a refresh
                        }
                        delete activeGameIntervals[`deleteTimer_${roomId}`]; // Clear timeout from map
                    }, 2 * 60 * 1000); // 2 minutes
                } else {
                    const stateToSend = getSanitizedGameState(gameState);
                    stateToSend.roomAdminId = room.creatorId;
                    io.to(roomId).emit('roomState', stateToSend);
                }
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

        const drawnCard = gameState.deck.pop();
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
        if (currentPlayer.uuid !== userId) return; // Not current player's turn
        if (currentPlayer.currentCards.length === 0) return; // Should have at least one card from previous round

        const lastCard = currentPlayer.currentCards[currentPlayer.currentCards.length - 1];
        const drawnCard = gameState.deck.pop();
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
        if (currentPlayer.uuid !== userId) return; // Not current player's turn
        if (currentPlayer.currentCards.length < 2) return; // Should have at least two cards from previous rounds

        const card1 = currentPlayer.currentCards[0];
        const card2 = currentPlayer.currentCards[1];
        const drawnCard = gameState.deck.pop();
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
        if (currentPlayer.uuid !== userId) return; // Not current player's turn
        if (currentPlayer.currentCards.length < 3) return; // Should have at least three cards from previous rounds

        const drawnCard = gameState.deck.pop();
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

        if (gameState.players.length < 2) {
            // Should probably emit error, but UI handles this check too
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

    socket.on('disconnect', () => console.log(`[Server] Usuario desconectado: ${socket.id}`));
});