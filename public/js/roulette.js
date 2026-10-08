
document.addEventListener('DOMContentLoaded', () => {
    // =============================================================================================
    // --- GLOBAL VARS & CONFIG ---
    // =============================================================================================
    const socket = io();
    const ROOM_ID = window.location.pathname.split('/').pop();
    let userUUID = localStorage.getItem('userUUID');
    let myPlayer = {};
    let currentWager = 5; // Default chip value
    let bettingInterval = null;
    let pendingResults = null;
    let distributionSkipped = false;
    let currentBettingEndsAt = null;
    let clockOffset = 0; // <-- ADDED: To hold results until animation ends

    const wheelnumbersAC = [0, 26, 3, 35, 12, 28, 7, 29, 18, 22, 9, 31, 14, 20, 1, 33, 16, 24, 5, 10, 23, 8, 30, 11, 36, 13, 27, 6, 34, 17, 25, 2, 21, 4, 19, 15, 32];
    const numRed = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

    // --- DOM Elements ---
    const lobbyView = document.getElementById('lobby-view');
    const gameWrapper = document.getElementById('game-wrapper');
    const gameContainer = document.getElementById('game-container');
    const distributionView = document.getElementById('distribution-view');
    const outOfPointsView = document.getElementById('out-of-points-view');
    const joinLobbyForm = document.getElementById('join-lobby-form');
    const playerNameInput = document.getElementById('playerName');
    const playerList = document.getElementById('player-list');
    const adminControls = document.getElementById('admin-controls');
    const startGameBtn = document.getElementById('start-game-btn');
    const bettingTimerEl = document.getElementById('betting-timer');
    const turnNotificationsEl = document.getElementById('turn-notifications');

    // =============================================================================================
    // --- 1. LOBBY & INITIALIZATION ---
    // =============================================================================================

    if (!userUUID) {
        userUUID = `user_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('userUUID', userUUID);
    }
    if (localStorage.getItem('userName')) playerNameInput.value = localStorage.getItem('userName');
    setTimeout(() => { if (lobbyView.style.display !== 'none') playerNameInput.focus(); }, 300);

    joinLobbyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = playerNameInput.value.trim();
        if (!name) return;
        localStorage.setItem('userName', name);

        socket.emit('joinRoom', {
            gameType: 'roulette',
            roomId: ROOM_ID,
            user: { name: name, uuid: userUUID }
        });

        initGameUI();
    });

    function initGameUI() {
        lobbyView.style.display = 'none';
        gameWrapper.classList.add('is-playing');
        buildWheel();
        buildBettingBoard();
    }

    // =============================================================================================
    // --- 2. SERVER COMMUNICATION (MAIN GAME LOOP) ---
    // =============================================================================================

    socket.on('roomState', (gameState) => {
        console.log("New Game State Received: ", gameState);
        myPlayer = gameState.players.find(p => p.uuid === userUUID) || {}; // Define myPlayer at the top

        // MODIFIED: Defer point updates until animation ends
        if (gameState.phase !== 'results') {
            updatePlayerList(gameState.players);
            updateBankDisplay(myPlayer.sips || 0, gameState.bets[userUUID]);
        }

        handleAdminControls(gameState); // <-- RE-ADD aDMIN BUTTON LOGIC
        handleZeroPoints(myPlayer, gameState.phase);
        updatePhaseView(gameState);
        renderMyBets(gameState.bets);

        // (clon) El reloj ya no se reinicia con cada apuesta: cuenta hasta la hora de cierre del servidor
        if (gameState.phase === 'betting') {
            if (gameState.bettingEndsAt) {
                if (gameState.bettingEndsAt !== currentBettingEndsAt) {
                    currentBettingEndsAt = gameState.bettingEndsAt;
                    clockOffset = (gameState.serverNow || Date.now()) - Date.now();
                    startBettingTimer(gameState.settings.bettingTime, gameState.bettingEndsAt);
                }
            } else if (!bettingInterval) {
                startBettingTimer(gameState.timer);
            }
        } else {
            stopBettingTimer();
            currentBettingEndsAt = null;
        }

        if (gameState.phase === 'spinning' && gameState.winningNumber !== null) {
            startSpinAnimation(gameState.winningNumber);
        }

        // MODIFIED: Store results instead of showing them immediately
        if (gameState.phase === 'results' && gameState.winningNumber !== null) {
            pendingResults = gameState;
        }
    });

    
    socket.on('error', (data) => { alert(`Error del servidor: ${data.message}`); window.location.href = '/'; });

    socket.on('roulette:drinksReceived', ({ from, amount }) => {
        Toastify({
            text: `${from} te manda ${amount} ${amount == 1 ? 'trago' : 'tragos'}`,
            duration: 7000,
            close: true,
            gravity: "top",
            position: "center",
            className: 'tp-toast--drink',
            stopOnFocus: true,
        }).showToast();

        const notifDiv = document.createElement('div');
        notifDiv.className = 'rl-notif';
        notifDiv.innerText = `${from} te manda ${amount} ${amount == 1 ? 'trago' : 'tragos'}`;
        turnNotificationsEl.appendChild(notifDiv);
    });

    // =============================================================================================
    // --- 3. UI & STATE HANDLERS ---
    // =============================================================================================

    function updatePlayerList(players) {
        playerList.innerHTML = '';
        players.forEach(p => {
            const li = tpPlayerChip(p.name, { offline: p.online === false, me: p.uuid === userUUID, meta: `${p.sips || 0} pts`, className: p.isSittingOut ? 'is-out' : '' });
            playerList.appendChild(li);
        });
    }

    function handleAdminControls(state) {
        const isAdmin = state.roomAdminId === userUUID;
        const canStart = state.phase === 'waiting' && state.players.length > 0;
        adminControls.style.display = (isAdmin && canStart) ? 'block' : 'none';
    }

    function handleZeroPoints(player, phase) {
        const bettingBoard = document.getElementById('betting_board');
        if (player.isSittingOut) {
            outOfPointsView.style.display = 'flex';
            const penaltyMessage = outOfPointsView.querySelector('p');
            // Show penalty message if applicable
            if (player.penaltyDrinks > 0) {
                penaltyMessage.innerText = `¡Bebes ${player.penaltyDrinks} tragos para volver a jugar!`;
            } else {
                penaltyMessage.innerText = 'Te quedaste sin puntos. Estarás fuera durante esta ronda.';
            }

            if(bettingBoard) bettingBoard.style.pointerEvents = 'none';
        } else {
            outOfPointsView.style.display = 'none';
            if(bettingBoard && phase === 'betting') bettingBoard.style.pointerEvents = 'auto';
        }
    }

    function updatePhaseView(gameState) {
        const meAsWinner = gameState.winners.find(w => w.uuid === userUUID);
        if (gameState.phase === 'distributing' && meAsWinner && meAsWinner.winAmount > 0 && !myPlayer.hasDistributed) {
            // (clon) Solo se monta al abrirse: antes se rehacía con cada aviso y borraba lo que estabas repartiendo
            if (distributionView.style.display !== 'flex' && !distributionSkipped) {
                setupDistributionView(gameState, meAsWinner);
                distributionView.style.display = 'flex';
            }
        } else {
            distributionView.style.display = 'none';
            distributionSkipped = false;
        }
        
        const bettingBoard = document.getElementById('betting_board');
        if (bettingBoard) {
             bettingBoard.style.pointerEvents = gameState.phase === 'betting' ? 'auto' : 'none';
        }
    }

    function handleResults(gameState) {
        turnNotificationsEl.innerHTML = ''; // Clear old drink notifications
        const meAsWinner = gameState.winners.find(w => w.uuid === userUUID);
        if (meAsWinner && meAsWinner.winAmount > 0) {
            let notification = buildNotification(`+${meAsWinner.winAmount} puntos`);
            gameWrapper.prepend(notification);
            setTimeout(() => notification.remove(), 4000);
        }
    }

    function setupDistributionView(gameState, meAsWinner) {
        const list = document.getElementById('distribution-player-list');
        const distributeBtn = document.getElementById('distribute-btn');
        const skipBtn = document.getElementById('skip-distribution-btn');
        const distTotalSipsEl = document.getElementById('dist-total-sips');
        const distRemainingSipsEl = document.getElementById('dist-remaining-sips');

        list.innerHTML = '';
        distTotalSipsEl.innerText = myPlayer.sips; // Show total sips
        distRemainingSipsEl.innerText = myPlayer.sips; // Initially, remaining is total

        const otherPlayers = gameState.players.filter(p => p.uuid !== userUUID);
        otherPlayers.forEach(p => {
            const li = document.createElement('li');
            li.className = 'rl-dist-row';
            const nm = document.createElement('span');
            nm.className = 'rl-dist-name';
            nm.textContent = p.name;
            li.appendChild(nm);
            const stepper = document.createElement('div');
            stepper.className = 'tp-stepper';
            stepper.innerHTML = `<button type="button" data-step="-1" aria-label="Menos">−</button><input type="number" inputmode="numeric" class="drink-input tp-input" data-player-uuid="${p.uuid}" min="0" value="0"><button type="button" data-step="1" aria-label="Más">+</button>`;
            li.appendChild(stepper);
            list.appendChild(li);
        });

        const updateRemainingSips = () => {
            let totalDistributedDrinks = 0;
            const inputs = list.getElementsByTagName('input');
            for (let input of inputs) {
                totalDistributedDrinks += parseInt(input.value, 10) || 0;
            }
            const remaining = myPlayer.sips - (totalDistributedDrinks * gameState.settings.drinkPrice);
            distRemainingSipsEl.innerText = remaining;
            distributeBtn.disabled = remaining < 0; // Disable if going negative
        };

        list.addEventListener('input', updateRemainingSips);

        distributeBtn.onclick = () => {
            const inputs = list.getElementsByTagName('input');
            const distribution = {};
            let totalCost = 0;
            for (let input of inputs) {
                const amount = parseInt(input.value, 10);
                if (amount > 0) {
                    distribution[input.dataset.playerUuid] = amount;
                    totalCost += amount * gameState.settings.drinkPrice;
                }
            }

            if (totalCost > myPlayer.sips) {
                alert("No tienes suficientes puntos para repartir esa cantidad de tragos.");
                return;
            }

            console.log('[DEBUG] Emitting roulette:distributeSips', { roomId: ROOM_ID, user: { uuid: userUUID }, distribution: distribution });
            socket.emit('roulette:distributeSips', { roomId: ROOM_ID, user: { uuid: userUUID }, distribution: distribution });
            distributionView.style.display = 'none';
        };

        skipBtn.onclick = () => { distributionView.style.display = 'none'; distributionSkipped = true; };
    }
    
    function startBettingTimer(seconds, endsAt) {
        stopBettingTimer();
        const total = Math.max(1, seconds);
        const end = endsAt || (Date.now() + seconds * 1000 + clockOffset);
        const leftNow = () => Math.max(0, Math.ceil((end - (Date.now() + clockOffset)) / 1000));
        const paint = () => {
            const timeLeft = leftNow();
            bettingTimerEl.innerHTML = `<span class="rl-timer-label">Hagan juego</span><span class="rl-timer-num num">${timeLeft}s</span><span class="rl-timer-bar" style="--left:${timeLeft / total}"></span>`;
            bettingTimerEl.classList.toggle('is-urgent', timeLeft <= 5);
            if (timeLeft <= 0) {
                clearInterval(bettingInterval); bettingInterval = null;
                bettingTimerEl.innerHTML = '<span class="rl-timer-label">No va más</span>';
            }
        };
        paint();
        bettingInterval = setInterval(paint, 250);
    }

    function stopBettingTimer() {
        clearInterval(bettingInterval); bettingInterval = null;
        bettingTimerEl.innerText = "";
        bettingTimerEl.classList.remove('is-urgent');
    }

    // =============================================================================================
    // --- 4. CLIENT ACTIONS (BETTING) ---
    // =============================================================================================

    function handlePlaceBet(type, value, element) {
        if (myPlayer.sips < currentWager) { return alert("No tienes puntos suficientes para esa ficha."); }
        if (element) { element.classList.remove('is-hit'); void element.offsetWidth; element.classList.add('is-hit'); }
        const bet = { type: type, value: String(value), amount: currentWager };
        socket.emit('roulette:placeBet', { roomId: ROOM_ID, user: { uuid: userUUID }, bet: bet });
    }

    function handleClearBets() {
        socket.emit('roulette:clearBets', { roomId: ROOM_ID, user: { uuid: userUUID } });
    }

    function clearAllChips() {
        const chips = document.querySelectorAll('.chip');
        chips.forEach(c => c.remove());
    }

    function renderMyBets(allBets) {
        clearAllChips();
        const myBets = allBets[userUUID];
        if (!myBets) return;

        const aggregatedBets = {};
        myBets.forEach(bet => {
            const key = `${bet.type}-${bet.value}`;
            aggregatedBets[key] = (aggregatedBets[key] || 0) + bet.amount;
        });

        for (const key in aggregatedBets) {
            const [type, value] = key.split('-');
            const amount = aggregatedBets[key];
            const element = document.querySelector(`[data-bet-type='${type}'][data-bet-value='${value}']`);
            if (element) {
                let chip = element.querySelector('.chip');
                if (!chip) {
                    chip = document.createElement('div');
                    chip.className = 'chip gold'; // Default chip color
                    chip.innerHTML = '<span class="chipSpan"></span>';
                    element.appendChild(chip);
                }
                const span = chip.querySelector('.chipSpan');
                span.innerText = amount;
            }
        }
    }

    // =============================================================================================
    // --- 5. UI BUILDING & ANIMATION (Adapted from RuletaEjemplo/app.js) ---
    // =============================================================================================

    // (clon) Rueda nueva en SVG: plato con las casillas, la bola viaja DENTRO del plato
    // para que al pararse quede exactamente en la casilla ganadora mientras el plato sigue girando.
    const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
    const SEG = 360 / WHEEL_ORDER.length;
    let wheelAngle = 0;
    let lastResultTimer = null;

    function buildWheel() {
        const NS = 'http://www.w3.org/2000/svg';
        const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [(r * Math.cos(a)).toFixed(2), (r * Math.sin(a)).toFixed(2)]; };
        const R_OUT = 158, R_IN = 104, R_NUM = 147;
        let pockets = '', labels = '', frets = '';
        WHEEL_ORDER.forEach((n, i) => {
            const a0 = i * SEG - SEG / 2, a1 = i * SEG + SEG / 2;
            const [x0, y0] = pt(R_OUT, a0), [x1, y1] = pt(R_OUT, a1), [x2, y2] = pt(R_IN, a1), [x3, y3] = pt(R_IN, a0);
            const cls = n === 0 ? 'rw-green' : (numRed.includes(n) ? 'rw-red' : 'rw-black');
            pockets += `<path class="${cls}" d="M${x0} ${y0} A${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${R_IN} ${R_IN} 0 0 0 ${x3} ${y3}Z"/>`;
            const [lx, ly] = pt(R_NUM, i * SEG);
            labels += `<text x="${lx}" y="${ly}" transform="rotate(${(i * SEG).toFixed(2)} ${lx} ${ly})">${n}</text>`;
            const [fx0, fy0] = pt(R_IN, a0), [fx1, fy1] = pt(R_OUT - 22, a0);
            frets += `<line x1="${fx0}" y1="${fy0}" x2="${fx1}" y2="${fy1}"/>`;
        });
        const wrap = document.createElement('div');
        wrap.className = 'wheel-wrap';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML = `
            <div class="rw">
              <svg class="rw-svg" viewBox="-200 -200 400 400">
                <defs>
                  <radialGradient id="rwBowl" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#174536"/><stop offset="1" stop-color="#061812"/></radialGradient>
                  <radialGradient id="rwHub" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#2a6a54"/><stop offset="1" stop-color="#0c2b22"/></radialGradient>
                </defs>
                <circle r="198" class="rw-rim"/>
                <circle r="190" fill="url(#rwBowl)"/>
                <circle r="166" class="rw-track-line"/>
                <g class="rw-rotor">
                  <circle r="192" fill="none"/>
                  <circle r="160" class="rw-ring"/>
                  <g class="rw-pockets">${pockets}</g>
                  <g class="rw-frets">${frets}</g>
                  <g class="rw-labels">${labels}</g>
                  <circle r="${R_IN}" fill="url(#rwHub)"/>
                  <circle r="${R_IN}" class="rw-inner-line"/>
                  <circle r="74" class="rw-inner-line rw-inner-line--soft"/>
                  <g class="rw-spokes"><rect x="-3" y="-62" width="6" height="124" rx="3"/><rect x="-62" y="-3" width="124" height="6" rx="3"/></g>
                  <circle r="20" class="rw-cap"/>
                  <circle r="7" class="rw-cap-dot"/>
                  <g class="rw-ball-orbit"><circle r="192" fill="none"/><g class="rw-ball-radius"><circle class="rw-ball" cx="0" cy="-176" r="8.5"/></g></g>
                </g>
                <path class="rw-pointer" d="M0 -184 L-9 -199 L9 -199Z"/>
              </svg>
            </div>
            <div class="rl-result" hidden></div>`;
        gameContainer.append(wrap);
        const ballOrbit = wrap.querySelector('.rw-ball-orbit');
        ballOrbit.style.opacity = '0';
    }

    function buildBettingBoard() {
        let bettingBoard = document.createElement('div');
        bettingBoard.setAttribute('id', 'betting_board');
        // (clon) Una sola rejilla para toda la mesa: en móvil vertical (cabe en pantalla), en escritorio horizontal
        const table = document.createElement('div');
        table.className = 'rl-table';
        const place = (el, v) => { for (const k in v) el.style.setProperty('--' + k, v[k]); };

        let bbtop = document.createElement('div');
        bbtop.setAttribute('class', 'bbtop');
        let bbtopBlocks = [
            { name: '1 a 18', type: 'low', value: 'low' },
            { name: 'Par', type: 'even', value: 'even' },
            { name: 'Rojo', type: 'color', value: 'red' },
            { name: 'Negro', type: 'color', value: 'black' },
            { name: 'Impar', type: 'odd', value: 'odd' },
            { name: '19 a 36', type: 'high', value: 'high' }
        ];
        bbtopBlocks.forEach((block, e) => {
            let bbtoptwo = document.createElement('div');
            bbtoptwo.setAttribute('class', 'bbtoptwo');
            bbtoptwo.setAttribute('data-bet-type', block.type);
            bbtoptwo.setAttribute('data-bet-value', block.value);
            if(block.value === 'red') bbtoptwo.classList.add('redNum');
            if(block.value === 'black') bbtoptwo.classList.add('blackNum');
            bbtoptwo.onclick = () => handlePlaceBet(block.type, block.value, bbtoptwo);
            bbtoptwo.innerText = block.name;
            place(bbtoptwo, { mr: 2 + 2 * e, mrs: 2, mc: 1, mcs: 1, dr: 5, drs: 1, dc: 2 + 2 * e, dcs: 2 });
            bbtop.append(bbtoptwo);
        });
        table.append(bbtop);

        let numberBoard = document.createElement('div');
        numberBoard.setAttribute('class', 'number_board');

        let zero = document.createElement('div');
        zero.setAttribute('class', 'number_0');
        zero.setAttribute('data-bet-type', 'number');
        zero.setAttribute('data-bet-value', '0');
        zero.onclick = () => handlePlaceBet('number', 0, zero);
        zero.innerHTML = '<div class="nbn">0</div>';
        place(zero, { mr: 1, mrs: 1, mc: 1, mcs: 5, dr: 1, drs: 3, dc: 1, dcs: 1 });
        numberBoard.append(zero);

        for (let i = 1; i <= 36; i++) {
            let numberBlock = document.createElement('div');
            numberBlock.setAttribute('class', 'number_block');
            numberBlock.setAttribute('data-bet-type', 'number');
            numberBlock.setAttribute('data-bet-value', i);
            if (numRed.includes(i)) numberBlock.classList.add('redNum');
            else numberBlock.classList.add('blackNum');
            numberBlock.onclick = () => handlePlaceBet('number', i, numberBlock);
            numberBlock.innerHTML = `<div class="nbn">${i}</div>`;
            place(numberBlock, { mr: Math.ceil(i / 3) + 1, mrs: 1, mc: ((i - 1) % 3) + 3, mcs: 1, dr: 3 - ((i - 1) % 3), drs: 1, dc: Math.ceil(i / 3) + 1, dcs: 1 });
            numberBoard.append(numberBlock);
        }
        table.append(numberBoard);

        let bo3Board = document.createElement('div');
        bo3Board.setAttribute('class', 'bo3_board');
        const bo3Blocks = [
            { name: '1-12', type: 'dozen', value: '1-12' },
            { name: '13-24', type: 'dozen', value: '13-24' },
            { name: '25-36', type: 'dozen', value: '25-36' }
        ];
        bo3Blocks.forEach((block, d) => {
            let bo3Block = document.createElement('div');
            bo3Block.setAttribute('class', 'bo3_block');
            bo3Block.setAttribute('data-bet-type', block.type);
            bo3Block.setAttribute('data-bet-value', block.value);
            bo3Block.onclick = () => handlePlaceBet(block.type, block.value, bo3Block);
            bo3Block.innerText = block.name;
            place(bo3Block, { mr: 2 + 4 * d, mrs: 4, mc: 2, mcs: 1, dr: 4, drs: 1, dc: 2 + 4 * d, dcs: 4 });
            bo3Board.append(bo3Block);
        });
        table.append(bo3Board);
        bettingBoard.append(table);

        // Chip selection deck
        let chipDeck = document.createElement('div');
        chipDeck.setAttribute('class', 'chipDeck');
        [1, 5, 10, 50, 100, 'Limpiar'].forEach((val, i) => {
            let chip = document.createElement('div');
            chip.className = `cdChip ${val === 5 ? 'cdChipActive' : ''}`;
            if (val === 'Limpiar') {
                chip.classList.add('clearBet');
                chip.onclick = handleClearBets;
            } else {
                chip.onclick = function() {
                    let currentActive = document.querySelector('.cdChipActive');
                    if(currentActive) currentActive.classList.remove('cdChipActive');
                    this.classList.add('cdChipActive');
                    currentWager = val;
                };
            }
            chip.setAttribute('role', 'button');
            chip.setAttribute('aria-label', val === 'Limpiar' ? 'Quitar mis fichas' : `Ficha de ${val}`);
            chip.innerHTML = val === 'Limpiar' ? '<span class="cdChipSpan"><i class="bi bi-x-lg"></i></span>' : `<span class="cdChipSpan">${val}</span>`;
            chipDeck.append(chip);
        });
        bettingBoard.prepend(chipDeck);

        // Bank and Bet display
        let bankContainer = document.createElement('div');
        bankContainer.setAttribute('class', 'bankContainer');
        bankContainer.innerHTML = '<div class="bank"><span>Puntos</span><span id="bankSpan" class="num">0</span></div><div class="bet"><span>Apostado</span><span id="betSpan" class="num">0</span></div><div class="last"><span>Última</span><span id="lastSpan" class="num">–</span></div>';
        bettingBoard.prepend(bankContainer);

        gameContainer.append(bettingBoard);
    }

    function updateBankDisplay(bank, playerBets) {
        console.log(`[DEBUG] updateBankDisplay called with: bank=${bank}, type=${typeof bank}`);
        const bankSpan = document.getElementById('bankSpan');
        const betSpan = document.getElementById('betSpan');
        if (bankSpan) bankSpan.innerText = (bank || 0).toLocaleString("en-GB");
        if(betSpan) {
            const totalBet = playerBets ? playerBets.reduce((acc, b) => acc + b.amount, 0) : 0;
            betSpan.innerText = totalBet.toLocaleString("en-GB");
        }
    }

    function startSpinAnimation(winningSpin) {
        const wrap = gameContainer.querySelector('.wheel-wrap');
        if (!wrap) return;
        const rotor = wrap.querySelector('.rw-rotor');
        const orbit = wrap.querySelector('.rw-ball-orbit');
        const radius = wrap.querySelector('.rw-ball-radius');
        const badge = wrap.querySelector('.rl-result');
        const idx = Math.max(0, WHEEL_ORDER.indexOf(Number(winningSpin)));
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        clearTimeout(lastResultTimer);
        badge.hidden = true;
        wrap.classList.remove('is-result');
        wrap.classList.add('is-spinning');

        // Plato: decelera durante ~9 s
        const W0 = wheelAngle % 360;
        const W1 = W0 + 360 * 2 + 137;
        wheelAngle = W1;
        const spinMs = reduce ? 1200 : 7600;
        const ballMs = reduce ? 1100 : 7000;
        rotor.getAnimations().forEach(an => an.cancel());
        orbit.getAnimations().forEach(an => an.cancel());
        radius.getAnimations().forEach(an => an.cancel());
        rotor.animate([{ transform: `rotate(${W0}deg)` }, { transform: `rotate(${W1}deg)` }],
            { duration: spinMs, easing: 'cubic-bezier(.18,.62,.22,1)', fill: 'forwards' });

        // Bola: gira en sentido contrario (relativo al plato) y termina en la casilla ganadora
        const R0 = -W0;                                // empieza arriba en pantalla
        let Rf = idx * SEG;
        while (Rf > R0 - 360 * 5) Rf -= 360;           // al menos 5 vueltas en contra
        orbit.style.opacity = '1';
        orbit.animate([{ transform: `rotate(${R0}deg)` }, { transform: `rotate(${Rf}deg)` }],
            { duration: ballMs, easing: 'cubic-bezier(.1,.68,.24,1)', fill: 'forwards' });
        // Al final cae de la pista a la casilla con un par de botes
        radius.animate([
            { transform: 'translateY(0)', offset: 0 },
            { transform: 'translateY(0)', offset: 0.72 },
            { transform: 'translateY(50px)', offset: 0.82 },
            { transform: 'translateY(36px)', offset: 0.87 },
            { transform: 'translateY(58px)', offset: 0.93 },
            { transform: 'translateY(52px)', offset: 0.97 },
            { transform: 'translateY(56px)', offset: 1 }
        ], { duration: ballMs, easing: 'linear', fill: 'forwards' });

        setTimeout(() => {
            if (pendingResults) {
                myPlayer = pendingResults.players.find(p => p.uuid === userUUID) || {};
                updatePlayerList(pendingResults.players);
                updateBankDisplay(myPlayer.sips || 0, pendingResults.bets[userUUID]);
                showWinningNumber(winningSpin);
                handleResults(pendingResults);
                pendingResults = null;
            } else {
                showWinningNumber(winningSpin);
            }
        }, reduce ? 6200 : 7600); // el servidor pasa a resultados a los 6 s y al reparto a los 11 s
    }

    function showWinningNumber(n) {
        const wrap = gameContainer.querySelector('.wheel-wrap');
        if (!wrap) return;
        const badge = wrap.querySelector('.rl-result');
        const num = Number(n);
        const color = num === 0 ? 'green' : (numRed.includes(num) ? 'red' : 'black');
        const label = num === 0 ? 'verde' : (color === 'red' ? 'rojo' : 'negro');
        badge.hidden = false;
        badge.className = `rl-result is-${color}`;
        badge.innerHTML = `<span class="num">${num}</span><small>${label}</small>`;
        badge.classList.remove('is-in'); void badge.offsetWidth; badge.classList.add('is-in');
        wrap.classList.add('is-result');

        const last = document.getElementById('lastSpan');
        if (last) { last.textContent = num; last.className = `num is-${color}`; }
        const cell = document.querySelector(`.rl-table [data-bet-type='number'][data-bet-value='${num}']`);
        if (cell) { cell.classList.remove('is-winner'); void cell.offsetWidth; cell.classList.add('is-winner'); setTimeout(() => cell.classList.remove('is-winner'), 6000); }

        clearTimeout(lastResultTimer);
        lastResultTimer = setTimeout(() => { wrap.classList.remove('is-spinning', 'is-result'); }, 3200);
    }

    function buildNotification(message) {
        let notification = document.createElement('div');
		notification.setAttribute('id', 'notification');
        notification.style.opacity = '1';
		let nSpan = document.createElement('div');
		nSpan.setAttribute('class', 'nSpan');
        nSpan.innerText = message;
        notification.append(nSpan);
        setTimeout(() => { notification.style.opacity = '0'; }, 3000);
        return notification;
    }

    // Admin start button listener
    startGameBtn.addEventListener('click', () => {
        socket.emit('roulette:startGame', { roomId: ROOM_ID, userId: userUUID });
    });
});
