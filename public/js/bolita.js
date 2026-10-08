document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Elements
    const waitingRoom = document.getElementById('waiting-room');
    const gameBoard = document.getElementById('game-board');
    const displayRoomName = document.getElementById('display-room-name');
    const playerCount = document.getElementById('player-count');
    const playersList = document.getElementById('players-list');
    const adminControls = document.getElementById('admin-controls');
    const startGameBtn = document.getElementById('start-game-btn');
    const turnIndicator = document.getElementById('turn-indicator');
    const lastActionContainer = document.getElementById('last-action-container');
    const lastActionText = document.getElementById('last-action-text');
    const gamePlayersList = document.getElementById('game-players-list');
    const adminPostGame = document.getElementById('admin-post-game');
    const resetGameBtn = document.getElementById('reset-game-btn');
    
    // Canvas elements
    const canvas = document.getElementById('bolita-canvas');
    const ctx = canvas.getContext('2d');
    const tapOverlay = document.getElementById('tap-overlay');

    // Modal elements
    // Hoja de premio (sustituye al modal de Bootstrap)
    const rewardModalEl = document.getElementById('rewardModal');
    const rewardModal = {
        show() { rewardModalEl.style.display = 'flex'; rewardModalEl.classList.remove('is-leaving'); },
        hide() { rewardModalEl.classList.add('is-leaving'); setTimeout(() => { rewardModalEl.style.display = 'none'; rewardModalEl.classList.remove('is-leaving'); }, 220); }
    };
    rewardModalEl.addEventListener('click', () => rewardModal.hide());
    const rewardText = document.getElementById('reward-text');
    const rewardDescription = document.getElementById('reward-description');
    const rewardPlayerName = document.getElementById('reward-player-name');

    // Name modal
    const nameModal = document.getElementById('name-modal');
    const nameInput = document.getElementById('name-input');
    const joinGameBtn = document.getElementById('join-game-btn');

    let roomAdminId = null;
    let latestGameState = null;
    const roomId = window.location.pathname.split('/').pop();
    
    let user = {
        uuid: localStorage.getItem('userUUID') || generateUUID(),
        name: localStorage.getItem('userName') || ''
    };
    localStorage.setItem('userUUID', user.uuid);

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // --- Join Logic ---
    function joinRoom(name) {
        user.name = name;
        localStorage.setItem('userName', user.name);
        nameModal.style.display = 'none';
        socket.emit('joinRoom', { gameType: 'bolita', roomId, user });
    }

    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGameBtn.click(); });
    joinGameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) joinRoom(name);
        else alert('Por favor, introduce un nombre.');
    });

    if (user.name) {
        nameInput.value = user.name;
        joinRoom(user.name);
    } else {
        nameModal.style.display = 'flex';
    }

    // --- Canvas & Physics Animation States ---
    let pegs = [];
    let prizes = [];
    let ballState = { dropping: false };
    
    let ballAnim = {
        x: 300,
        y: 80,
        r: 12,
        active: false,
        dropStartTime: 0,
        path: null,
        trail: [] // Array of {x, y} to draw trailing blur
    };

    let particles = [];
    let pegFlashes = {}; // pegId -> intensity (0-10)
    let lastHitPegId = null;
    let currentOscillatingX = 300;
    let lastDropKey = '';

    // Trigger sparkles when ball hits peg
    function spawnSparkles(x, y, color) {
        for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 4;
            particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed * 60, // 60fps scaling
                vy: Math.sin(angle) * speed * 60 - 30, // upward bias
                r: 1.5 + Math.random() * 2,
                color: color || '#eef1ea',
                alpha: 1,
                decay: 0.02 + Math.random() * 0.03,
                gravity: 200
            });
        }
    }

    // Trigger confetti when landing in a hole
    function spawnConfetti(x, y) {
        const colors = ['#ff5a3c', '#eef1ea', '#8fe3b0', '#f3c969', '#c9d6ce', '#ffffff'];
        for (let i = 0; i < 50; i++) {
            const angle = Math.PI + (Math.random() - 0.5) * (Math.PI / 1.5); // upward cone
            const speed = 4 + Math.random() * 7;
            particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed * 60,
                vy: Math.sin(angle) * speed * 60,
                r: 3 + Math.random() * 4,
                color: colors[Math.floor(Math.random() * colors.length)],
                alpha: 1,
                decay: 0.01 + Math.random() * 0.01,
                gravity: 120
            });
        }
    }

    // Local physics simulation game loop
    function gameLoop(timestamp) {
        // 1. Update ball position
        if (ballAnim.active && ballAnim.path) {
            const elapsed = performance.now() - ballAnim.dropStartTime;
            const stepIndex = elapsed / (1000 / 60); // 60hz steps

            if (stepIndex < ballAnim.path.length - 1) {
                const i = Math.floor(stepIndex);
                const f = stepIndex - i;
                const nextX = ballAnim.path[i].x * (1 - f) + ballAnim.path[i + 1].x * f;
                const nextY = ballAnim.path[i].y * (1 - f) + ballAnim.path[i + 1].y * f;

                ballAnim.x = nextX;
                ballAnim.y = nextY;

                // Push to trail
                ballAnim.trail.push({ x: ballAnim.x, y: ballAnim.y });
                if (ballAnim.trail.length > 8) ballAnim.trail.shift();

                // Peg collision sparkle detection
                let insidePeg = false;
                for (const peg of pegs) {
                    const dx = ballAnim.x - peg.x;
                    const dy = ballAnim.y - peg.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < ballAnim.r + peg.r + 2) {
                        insidePeg = true;
                        if (lastHitPegId !== peg.id) {
                            pegFlashes[peg.id] = 10;
                            spawnSparkles(peg.x, peg.y, peg.isBumper ? '#ff5a3c' : '#eef1ea');
                            lastHitPegId = peg.id;
                        }
                    }
                }
                if (!insidePeg) {
                    lastHitPegId = null;
                }
            } else {
                // Ball landed
                const finalPos = ballAnim.path[ballAnim.path.length - 1];
                ballAnim.x = finalPos.x;
                ballAnim.y = finalPos.y;
                ballAnim.active = false;
                ballAnim.trail = [];

                // Confetti and modal
                spawnConfetti(ballAnim.x, ballAnim.y);
                highlightSlot(ballAnim.x);
                showLocalRewardModal();
            }
        } else if (!ballState.dropping) {
            // Ball is oscillating at the top
            currentOscillatingX = 300 + Math.sin(Date.now() / 250) * 260;
            ballAnim.x = currentOscillatingX;
            ballAnim.y = 80;
            ballAnim.trail = [];
        }

        // 2. Update particles
        for (let idx = particles.length - 1; idx >= 0; idx--) {
            const p = particles[idx];
            if (p.gravity) p.vy += p.gravity * (1 / 60);
            p.x += p.vx * (1 / 60);
            p.y += p.vy * (1 / 60);
            p.alpha -= p.decay;
            if (p.alpha <= 0) particles.splice(idx, 1);
        }

        // 3. Update flashes
        for (const id in pegFlashes) {
            if (pegFlashes[id] > 0) pegFlashes[id]--;
        }

        // 4. Render
        drawBoard();

        requestAnimationFrame(gameLoop);
    }

    // (clon) Render optimizado: el tablero estático (fondo, casillas, clavos con su brillo) se pinta
    // UNA vez por turno en una capa aparte; cada fotograma solo se dibujan la bola, chispas y destellos.
    // Sin shadowBlur por fotograma (era lo que hacía ir a tirones en móvil) y a la densidad real de la pantalla.
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = 600 * DPR;
    canvas.height = 800 * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const staticLayer = document.createElement('canvas');
    staticLayer.width = canvas.width;
    staticLayer.height = canvas.height;
    const sctx = staticLayer.getContext('2d');
    let staticKey = '';

    // Brillo pre-renderizado (sprite) para destellos y bola
    function makeGlow(color, size) {
        const c = document.createElement('canvas');
        c.width = c.height = size * DPR;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, c.width / 2);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, c.width, c.height);
        return c;
    }
    const glowWhite = makeGlow('rgba(255,255,255,0.75)', 64);
    const glowRed = makeGlow('rgba(255,90,60,0.6)', 64);

    // Etiquetas de premio en HTML (nítidas y sin cortarse)
    const slotsEl = document.createElement('div');
    slotsEl.className = 'bl-slots';
    slotsEl.setAttribute('aria-hidden', 'true');
    canvas.parentElement.appendChild(slotsEl);
    let slotsKey = '';

    function prizeLines(prize) {
        const v = Number(prize.value) || 0;
        switch (prize.type) {
            case 'BEBE': return ['Bebe', `${v} ${v === 1 ? 'trago' : 'tragos'}`];
            case 'REPARTE': return ['Reparte', `${v} ${v === 1 ? 'trago' : 'tragos'}`];
            case 'TODOS': return ['Beben', 'todos'];
            case 'CHUPITO': return ['Te toca', 'chupito'];
            case 'MANDA_CHUPITO': return ['Manda', 'chupito'];
            case 'SALVADO': return ['Te', 'salvas'];
            default: {
                const t = String(prize.text || '').replace(/[¡!]/g, '');
                const i = t.indexOf(' ');
                return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : ['', t];
            }
        }
    }

    function renderSlots() {
        const key = prizes.map(p => p && p.text).join('|');
        if (key === slotsKey) return;
        slotsKey = key;
        slotsEl.innerHTML = '';
        for (let i = 0; i < 6; i++) {
            const prize = prizes[i];
            const cell = document.createElement('div');
            cell.className = 'bl-slot' + (prize && (prize.type === 'REPARTE' || prize.type === 'MANDA_CHUPITO' || prize.type === 'SALVADO') ? ' is-good' : '');
            if (prize) {
                const [l1, l2] = prizeLines(prize);
                const a = document.createElement('small'); a.textContent = l1;
                const b = document.createElement('strong'); b.textContent = l2;
                cell.append(a, b);
            }
            slotsEl.appendChild(cell);
        }
    }

    function highlightSlot(x) {
        const idx = Math.max(0, Math.min(5, Math.floor(x / 100)));
        const cell = slotsEl.children[idx];
        if (!cell) return;
        cell.classList.remove('is-hit'); void cell.offsetWidth; cell.classList.add('is-hit');
        setTimeout(() => cell.classList.remove('is-hit'), 3200);
    }

    function paintStatic() {
        const key = pegs.map(p => p.id + p.x + ',' + p.y + p.r).join(';');
        if (key === staticKey) return;
        staticKey = key;
        const c = sctx;
        c.setTransform(DPR, 0, 0, DPR, 0, 0);
        c.clearRect(0, 0, 600, 800);

        const bgGrad = c.createRadialGradient(300, 380, 40, 300, 400, 620);
        bgGrad.addColorStop(0, '#1b4c3c');
        bgGrad.addColorStop(1, '#08201a');
        c.fillStyle = bgGrad;
        c.fillRect(0, 0, 600, 800);

        // zona de salida
        c.fillStyle = 'rgba(238,241,234,0.04)';
        c.fillRect(0, 0, 600, 120);
        c.strokeStyle = 'rgba(238,241,234,0.12)';
        c.setLineDash([6, 8]); c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, 120); c.lineTo(600, 120); c.stroke();
        c.setLineDash([]);

        // casillas
        for (let i = 0; i < 6; i++) {
            c.fillStyle = i % 2 === 0 ? 'rgba(6,24,18,0.55)' : 'rgba(17,55,44,0.55)';
            c.fillRect(i * 100, 680, 100, 120);
        }
        c.strokeStyle = 'rgba(238, 241, 234, 0.35)';
        c.lineWidth = 4; c.lineCap = 'round';
        for (let i = 1; i <= 5; i++) {
            c.beginPath(); c.moveTo(i * 100, 680); c.lineTo(i * 100, 800); c.stroke();
        }

        pegs.forEach(peg => {
            if (peg.isDividerPeg) {
                c.fillStyle = '#c9d6ce';
                c.beginPath(); c.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2); c.fill();
            } else if (peg.isBumper) {
                c.drawImage(glowRed, peg.x - 40, peg.y - 40, 80, 80);
                c.strokeStyle = '#ff5a3c'; c.lineWidth = 3;
                c.beginPath(); c.arc(peg.x, peg.y, peg.r + 4, 0, Math.PI * 2); c.stroke();
                c.fillStyle = '#ff5a3c';
                c.beginPath(); c.arc(peg.x, peg.y, peg.r - 2, 0, Math.PI * 2); c.fill();
                c.fillStyle = 'rgba(255,255,255,0.35)';
                c.beginPath(); c.arc(peg.x - peg.r * 0.3, peg.y - peg.r * 0.3, peg.r * 0.35, 0, Math.PI * 2); c.fill();
            } else {
                c.fillStyle = 'rgba(2,14,10,0.45)';
                c.beginPath(); c.arc(peg.x + 1, peg.y + 2, peg.r, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#eef1ea';
                c.beginPath(); c.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2); c.fill();
            }
        });
    }

    function drawBoard() {
        paintStatic();
        renderSlots();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(staticLayer, 0, 0);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

        // destellos de clavos tocados
        for (const peg of pegs) {
            const f = pegFlashes[peg.id];
            if (!f) continue;
            const k = f / 10;
            ctx.globalAlpha = k;
            const sz = (peg.r + 18) * 2;
            ctx.drawImage(glowWhite, peg.x - sz / 2, peg.y - sz / 2, sz, sz);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(peg.x, peg.y, peg.r + (peg.isBumper ? 4 : 2) * k, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // partículas
        for (const p of particles) {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = Math.max(0, p.alpha);
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // estela
        if (ballAnim.active) {
            const n = ballAnim.trail.length;
            ballAnim.trail.forEach((pos, idx) => {
                ctx.globalAlpha = (idx + 1) / n * 0.35;
                ctx.fillStyle = '#ff5a3c';
                ctx.beginPath(); ctx.arc(pos.x, pos.y, ballAnim.r * ((idx + 1) / n), 0, Math.PI * 2); ctx.fill();
            });
            ctx.globalAlpha = 1;
        }

        // bola
        ctx.drawImage(glowRed, ballAnim.x - 30, ballAnim.y - 30, 60, 60);
        const ballGrad = ctx.createRadialGradient(ballAnim.x - 4, ballAnim.y - 4, 1, ballAnim.x, ballAnim.y, ballAnim.r);
        ballGrad.addColorStop(0, '#ffffff');
        ballGrad.addColorStop(0.35, '#ffb3a4');
        ballGrad.addColorStop(1, '#ff5a3c');
        ctx.fillStyle = ballGrad;
        ctx.beginPath(); ctx.arc(ballAnim.x, ballAnim.y, ballAnim.r, 0, Math.PI * 2); ctx.fill();
    }

    function showLocalRewardModal() {
        if (!latestGameState || !latestGameState.ballState || !latestGameState.ballState.reward) return;
        
        const playerUuid = latestGameState.turnOrder[latestGameState.currentPlayerIndex];
        const player = latestGameState.players.find(p => p.uuid === playerUuid);
        const reward = latestGameState.ballState.reward;

        rewardPlayerName.textContent = `A ${player ? player.name : 'alguien'} le toca`;
        rewardText.textContent = reward.text;
        
        let desc = '¡Salud! A cumplir el castigo.';
        if (reward.type === 'REPARTE') desc = 'Elige a quién mandar estos tragos.';
        else if (reward.type === 'SALVADO') desc = '¡Te has librado por los pelos! Pasa el vaso.';
        else if (reward.type === 'TODOS') desc = '¡Arriba, abajo, al centro y para dentro! Beben todos.';
        else if (reward.type === 'CHUPITO') desc = '¡Un trago corto de fuego! Te toca chupito.';
        else if (reward.type === 'MANDA_CHUPITO') desc = 'Elige a la víctima de este chupito.';
        
        rewardDescription.textContent = desc;
        rewardModal.show();

        // Auto close modal after 3 seconds
        setTimeout(() => {
            rewardModal.hide();
        }, 3000);
    }

    // --- Socket Handlers ---
    socket.on('roomState', (gameState) => {
        const prevPhase = latestGameState ? latestGameState.phase : null;
        latestGameState = gameState;
        roomAdminId = gameState.roomAdminId;
        pegs = gameState.pegs || [];
        prizes = gameState.prizes || [];
        ballState = gameState.ballState || { dropping: false };

        updateUI(gameState);

        // (clon) Si yo lancé la bola y ya la estoy animando con mi predicción, paso a la trayectoria
        // del servidor (manda él) sin reiniciar el tiempo: así la casilla siempre coincide con el premio.
        const dropKey = ballState.path ? `${ballState.startX}_${ballState.path.length}_${ballState.finalHole}` : '';
        if (gameState.phase === 'playing' && ballState.dropping && ballAnim.active && ballState.path) {
            ballAnim.path = ballState.path;
            lastDropKey = dropKey;
        }
        // If a ball was just dropped and we aren't animating locally yet, start the animation!
        // (clon) ...pero solo una vez por tirada: otros avisos del servidor durante la caída no la repiten
        if (gameState.phase === 'playing' && ballState.dropping && !ballAnim.active && ballState.path && dropKey !== lastDropKey) {
            lastDropKey = dropKey;
            ballAnim.path = ballState.path;
            ballAnim.x = ballState.startX;
            ballAnim.y = 80;
            ballAnim.active = true;
            ballAnim.dropStartTime = performance.now();
            ballAnim.trail = [];
        }
    });

    socket.on('error', (err) => {
        alert(err.message);
    });

    // --- UI Update Logic ---
    function updateUI(state) {
        displayRoomName.textContent = state.name || roomId;

        if (state.phase === 'waiting') {
            waitingRoom.classList.remove('d-none');
            gameBoard.classList.add('d-none');
            renderWaitingRoom(state);
        } else {
            waitingRoom.classList.add('d-none');
            gameBoard.classList.remove('d-none');
            renderGameBoard(state);
        }

        // Admin controls visibility
        if (state.roomAdminId === user.uuid) {
            if (state.phase === 'waiting') {
                adminControls.classList.remove('d-none');
            } else {
                adminControls.classList.add('d-none');
            }

            adminPostGame.classList.remove('d-none');
        } else {
            adminControls.classList.add('d-none');
            adminPostGame.classList.add('d-none');
        }
    }

    function renderWaitingRoom(state) {
        playerCount.textContent = state.players.length;
        playersList.innerHTML = '';
        state.players.forEach(p => {
            const li = tpPlayerChip(p.name, { offline: p.online === false, me: p.uuid === user.uuid, meta: p.uuid === state.roomAdminId ? 'anfitrión' : '', className: p.online ? '' : 'is-offline' });
            playersList.appendChild(li);
        });
    }

    function renderGameBoard(state) {
        const currentPlayerUuid = state.turnOrder[state.currentPlayerIndex];
        const isMyTurn = currentPlayerUuid === user.uuid;
        const currentPlayer = state.players.find(p => p.uuid === currentPlayerUuid);

        if (state.phase === 'finished') {
            turnIndicator.textContent = 'Partida terminada';
            turnIndicator.className = 'is-finished';
            tapOverlay.classList.add('d-none');
        } else {
            if (state.ballState && state.ballState.dropping) {
                turnIndicator.textContent = `Cae la bola de ${currentPlayer ? currentPlayer.name : '...'}`;
                turnIndicator.className = 'is-dropping';
                tapOverlay.classList.add('d-none');
            } else {
                turnIndicator.textContent = isMyTurn ? 'Te toca' : `Turno de ${currentPlayer ? currentPlayer.name : '...'}`;
                turnIndicator.className = isMyTurn ? 'is-my-turn' : '';

                if (isMyTurn) {
                    tapOverlay.classList.remove('d-none');
                } else {
                    tapOverlay.classList.add('d-none');
                }
            }
        }

        // Render sidebar players list with active highlights
        gamePlayersList.innerHTML = '';
        state.turnOrder.forEach((uuid, index) => {
            const p = state.players.find(player => player.uuid === uuid);
            if (p) {
                const isActive = index === state.currentPlayerIndex;
                const li = tpPlayerChip(p.name, { offline: p.online === false, turn: isActive && state.phase !== 'finished', me: p.uuid === user.uuid, className: (isActive ? 'active-turn ' : '') + (p.online ? '' : 'is-offline') });
                gamePlayersList.appendChild(li);
            }
        });

        // Show last action
        if (state.lastAction) {
            lastActionContainer.classList.remove('d-none');
            lastActionText.textContent = `Último tiro: ${state.lastAction.playerName}, ${state.lastAction.reward.text}`;
        } else {
            lastActionContainer.classList.add('d-none');
        }
    }

    // --- Action triggers ---
    function triggerDrop() {
        if (!latestGameState || latestGameState.phase !== 'playing') return;
        const currentPlayerUuid = latestGameState.turnOrder[latestGameState.currentPlayerIndex];
        if (currentPlayerUuid !== user.uuid) return;
        if (latestGameState.ballState && latestGameState.ballState.dropping) return;

        // 1. Run client-side prediction path calculation (instantaneous!)
        const result = BolitaPhysics.simulateBallDrop(currentOscillatingX, pegs);
        ballAnim.path = result.path;
        ballAnim.x = currentOscillatingX;
        ballAnim.y = 80;
        ballAnim.active = true;
        ballAnim.dropStartTime = performance.now();
        ballAnim.trail = [];

        // 2. Optimistically update local states for instant visual feedback
        ballState.dropping = true;
        
        turnIndicator.textContent = 'Cae tu bola';
        turnIndicator.className = 'is-dropping';
        tapOverlay.classList.add('d-none');

        // 3. Emit the drop event to the server to synchronize other players
        socket.emit('bolita:dropBall', { roomId, userId: user.uuid, startX: currentOscillatingX });
    }

    

    

    tapOverlay.addEventListener('click', triggerDrop);

    startGameBtn.addEventListener('click', () => {
        socket.emit('bolita:startGame', { roomId, userId: user.uuid });
    });

    resetGameBtn.addEventListener('click', () => {
        socket.emit('bolita:resetGame', { roomId, userId: user.uuid });
    });

    // Start Game Loop
    requestAnimationFrame(gameLoop);
});
