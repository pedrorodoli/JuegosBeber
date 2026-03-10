
document.addEventListener('DOMContentLoaded', () => {
    // =============================================================================================
    // --- GLOBAL VARS & CONFIG ---
    // =============================================================================================
    const socket = io();
    const ROOM_ID = window.location.pathname.split('/').pop();
    let userUUID = localStorage.getItem('user_uuid');
    let myPlayer = {};
    let currentWager = 5; // Default chip value
    let bettingInterval = null;
    let pendingResults = null; // <-- ADDED: To hold results until animation ends

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
        localStorage.setItem('user_uuid', userUUID);
    }

    joinLobbyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = playerNameInput.value;
        if (!name) return;

        socket.emit('joinRoom', {
            gameType: 'roulette',
            roomId: ROOM_ID,
            user: { name: name, uuid: userUUID }
        });

        initGameUI();
    });

    function initGameUI() {
        lobbyView.style.display = 'none';
        gameWrapper.style.display = 'block';
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

        if (gameState.phase === 'betting') {
            startBettingTimer(gameState.timer);
        } else {
            stopBettingTimer();
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
            text: `¡Recibes ${amount} trago(s) de ${from}! 🍻`,
            duration: 7000,
            close: true,
            gravity: "top",
            position: "right",
            backgroundColor: "linear-gradient(to right, #00b09b, #96c93d)",
            stopOnFocus: true,
        }).showToast();

        const notifDiv = document.createElement('div');
        notifDiv.innerText = `Recibes ${amount} trago(s) de ${from}!`;
        turnNotificationsEl.appendChild(notifDiv);
    });

    // =============================================================================================
    // --- 3. UI & STATE HANDLERS ---
    // =============================================================================================

    function updatePlayerList(players) {
        playerList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="player-name">${p.name}</span> <span class="player-sips">${p.sips || 0} pts</span>`;
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
            setupDistributionView(gameState, meAsWinner);
            distributionView.style.display = 'flex';
        } else {
            distributionView.style.display = 'none';
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
            let notification = buildNotification(`Ganaste ${meAsWinner.winAmount} puntos!`);
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
            li.innerHTML = `<span>${p.name}</span> <input type="number" class="drink-input" data-player-uuid="${p.uuid}" min="0" value="0" style="width: 60px;">`;
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

        skipBtn.onclick = () => { distributionView.style.display = 'none'; };
    }
    
    function startBettingTimer(seconds) {
        stopBettingTimer();
        let timeLeft = seconds;
        bettingTimerEl.innerText = `Tiempo para apostar: ${timeLeft}s`;
        bettingInterval = setInterval(() => {
            timeLeft--;
            bettingTimerEl.innerText = `Tiempo para apostar: ${timeLeft}s`;
            if (timeLeft <= 0) {
                stopBettingTimer();
                bettingTimerEl.innerText = "¡No va más!";
            }
        }, 1000);
    }

    function stopBettingTimer() {
        clearInterval(bettingInterval);
        bettingTimerEl.innerText = "";
    }

    // =============================================================================================
    // --- 4. CLIENT ACTIONS (BETTING) ---
    // =============================================================================================

    function handlePlaceBet(type, value, element) {
        if (myPlayer.sips < currentWager) { return alert("No tienes suficientes puntos para esta apuesta."); }
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

    function buildWheel() {
        let wheel = document.createElement('div');
        wheel.setAttribute('class', 'wheel');
        let outerRim = document.createElement('div');
        outerRim.setAttribute('class', 'outerRim');
        wheel.append(outerRim);
        let numbers = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
        for (let i = 0; i < numbers.length; i++) {
            let a = i + 1;
            let spanClass = (numbers[i] < 10) ? 'single' : 'double';
            let sect = document.createElement('div');
            sect.setAttribute('id', 'sect' + a);
            sect.setAttribute('class', 'sect');
            let span = document.createElement('span');
            span.setAttribute('class', spanClass);
            span.innerText = numbers[i];
            sect.append(span);
            let block = document.createElement('div');
            block.setAttribute('class', 'block');
            sect.append(block);
            wheel.append(sect);
        }
        let pocketsRim = document.createElement('div');
        pocketsRim.setAttribute('class', 'pocketsRim');
        wheel.append(pocketsRim);
        let ballTrack = document.createElement('div');
        ballTrack.setAttribute('class', 'ballTrack');
        let ball = document.createElement('div');
        ball.setAttribute('class', 'ball');
        ballTrack.append(ball);
        wheel.append(ballTrack);
        let pockets = document.createElement('div');
        pockets.setAttribute('class', 'pockets');
        wheel.append(pockets);
        let cone = document.createElement('div');
        cone.setAttribute('class', 'cone');
        wheel.append(cone);
        let turret = document.createElement('div');
        turret.setAttribute('class', 'turret');
        wheel.append(turret);
        let turretHandle = document.createElement('div');
        turretHandle.setAttribute('class', 'turretHandle');
        let thendOne = document.createElement('div');
        thendOne.setAttribute('class', 'thendOne');
        turretHandle.append(thendOne);
        let thendTwo = document.createElement('div');
        thendTwo.setAttribute('class', 'thendTwo');
        turretHandle.append(thendTwo);
        wheel.append(turretHandle);
        gameContainer.append(wheel);
    }

    function buildBettingBoard() {
        let bettingBoard = document.createElement('div');
        bettingBoard.setAttribute('id', 'betting_board');

        let bbtop = document.createElement('div');
        bbtop.setAttribute('class', 'bbtop');
        let bbtopBlocks = [
            { name: '1 to 18', type: 'low', value: 'low' },
            { name: 'EVEN', type: 'even', value: 'even' },
            { name: 'RED', type: 'color', value: 'red' },
            { name: 'BLACK', type: 'color', value: 'black' },
            { name: 'ODD', type: 'odd', value: 'odd' },
            { name: '19 to 36', type: 'high', value: 'high' }
        ];
        bbtopBlocks.forEach(block => {
            let bbtoptwo = document.createElement('div');
            bbtoptwo.setAttribute('class', 'bbtoptwo');
            bbtoptwo.setAttribute('data-bet-type', block.type);
            bbtoptwo.setAttribute('data-bet-value', block.value);
            if(block.name === 'RED') bbtoptwo.classList.add('redNum');
            if(block.name === 'BLACK') bbtoptwo.classList.add('blackNum');
            bbtoptwo.onclick = () => handlePlaceBet(block.type, block.value, bbtoptwo);
            bbtoptwo.innerText = block.name;
            bbtop.append(bbtoptwo);
        });
        bettingBoard.append(bbtop);

        let numberBoard = document.createElement('div');
        numberBoard.setAttribute('class', 'number_board');

        let zero = document.createElement('div');
        zero.setAttribute('class', 'number_0');
        zero.setAttribute('data-bet-type', 'number');
        zero.setAttribute('data-bet-value', '0');
        zero.onclick = () => handlePlaceBet('number', 0, zero);
        zero.innerHTML = '<div class="nbn">0</div>';
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
            numberBoard.append(numberBlock);
        }
        bettingBoard.append(numberBoard);

        let bo3Board = document.createElement('div');
        bo3Board.setAttribute('class', 'bo3_board');
        const bo3Blocks = [
            { name: '1st 12', type: 'dozen', value: '1-12' },
            { name: '2nd 12', type: 'dozen', value: '13-24' },
            { name: '3rd 12', type: 'dozen', value: '25-36' }
        ];
        bo3Blocks.forEach(block => {
            let bo3Block = document.createElement('div');
            bo3Block.setAttribute('class', 'bo3_block');
            bo3Block.setAttribute('data-bet-type', block.type);
            bo3Block.setAttribute('data-bet-value', block.value);
            bo3Block.onclick = () => handlePlaceBet(block.type, block.value, bo3Block);
            bo3Block.innerText = block.name;
            bo3Board.append(bo3Block);
        });
        bettingBoard.append(bo3Board);

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
            chip.innerHTML = `<span class="cdChipSpan">${val}</span>`;
            chipDeck.append(chip);
        });
        bettingBoard.append(chipDeck);

        // Bank and Bet display
        let bankContainer = document.createElement('div');
        bankContainer.setAttribute('class', 'bankContainer');
        bankContainer.innerHTML = '<div class="bank">Puntos: <span id="bankSpan">0</span></div><div class="bet">Apostado: <span id="betSpan">0</span></div>';
        bettingBoard.append(bankContainer);

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
        const wheel = gameContainer.querySelector('.wheel');
        const ballTrack = gameContainer.querySelector('.ballTrack');
        if (!wheel || !ballTrack) return;

        let degree = 0;
        for(let i = 0; i < wheelnumbersAC.length; i++){
            if(wheelnumbersAC[i] == winningSpin){
                degree = (i * 9.73) + 362;
            }
        }

        wheel.style.cssText = 'animation: wheelRotate 5s linear infinite;';
        ballTrack.style.cssText = 'animation: ballRotate 1s linear infinite;';

        let style = document.getElementById('roulette-spin-animation');
        if (!style) {
            style = document.createElement('style');
            style.id = 'roulette-spin-animation';
            document.head.appendChild(style);
        }

        setTimeout(() => {
            ballTrack.style.cssText = 'animation: ballRotate 2s linear infinite;';
            style.innerText = `@keyframes ballStop {from {transform: rotate(0deg);}to{transform: rotate(-${degree}deg);}}`;
        }, 2000);
        setTimeout(() => { ballTrack.style.cssText = 'animation: ballStop 3s linear;'; }, 6000);
        setTimeout(() => { ballTrack.style.cssText = `transform: rotate(-${degree}deg);`; }, 9000);
        setTimeout(() => { 
            wheel.style.cssText = '';
            if(style) style.remove();
            // ADDED: Check for and display pending results after animation
            if (pendingResults) {
                // Update points and player list now that animation is over
                myPlayer = pendingResults.players.find(p => p.uuid === userUUID) || {};
                updatePlayerList(pendingResults.players);
                updateBankDisplay(myPlayer.sips || 0, pendingResults.bets[userUUID]);
                
                // Show win/loss message
                handleResults(pendingResults);
                pendingResults = null;
            }
        }, 10000);
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
