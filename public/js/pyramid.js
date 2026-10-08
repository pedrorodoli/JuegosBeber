document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Game elements
    const pyramidArea = document.getElementById('pyramid-area');
    const playerHandElement = document.getElementById('player-hand');
    const playerActionsElement = document.getElementById('player-actions');
    const actionsLog = document.getElementById('actions-log');
    const playerList = document.getElementById('player-list');
    const myDrinksCount = document.getElementById('my-drinks-count');

    // Modal elements
    const nameModal = document.getElementById('name-modal');
    const nameInput = document.getElementById('name-input');
    const joinGameBtn = document.getElementById('join-game-btn');

    const targetModal = document.getElementById('target-modal');
    const targetPlayerList = document.getElementById('target-player-list');
    const cancelTargetBtn = document.getElementById('cancel-target-btn');

    const challengeModal = document.getElementById('challenge-modal');
    const challengeTitle = document.getElementById('challenge-title');
    const challengeText = document.getElementById('challenge-text');
    const challengePyramidCard = document.getElementById('challenge-pyramid-card');
    const challengeAcceptBtn = document.getElementById('challenge-accept-btn');
    const challengeRejectBtn = document.getElementById('challenge-reject-btn');

    let user = {};
    const roomId = window.location.pathname.split('/').pop();
    let roomAdminId = null;
    let isSelectingCard = false; // State to manage card selection
    let revealedSeen = null;      // cartas de la pirámide ya giradas (para animar solo las nuevas)
    let lastGameState = null;

    // --- Join Logic ---
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGameBtn.click(); });
    joinGameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return alert('Escribe tu nombre para entrar.'); }
        user = { uuid: localStorage.getItem('userUUID') || uuidv4(), name };
        localStorage.setItem('userUUID', user.uuid);
        localStorage.setItem('userName', user.name);
        nameModal.style.display = 'none';
        socket.emit('joinRoom', { gameType: 'pyramid', roomId, user });
    });

    if (localStorage.getItem('userName')) {
        nameInput.value = localStorage.getItem('userName');
    }

    // --- Socket Handlers ---
    socket.on('roomState', (gameState) => {
        console.log('New Game State:', gameState);
        roomAdminId = gameState.roomAdminId;
        updateUI(gameState);
    });

    socket.on('error', (error) => alert(`Error: ${error.message}`));

    socket.on('pyramid:show-toast', ({ message }) => {
        Toastify({
            text: message,
            duration: 4000,
            gravity: "top",
            position: "center",
            className: 'tp-toast--drink'
        }).showToast();
    });

    // --- UI Rendering ---
    function updateUI(gameState) {
        lastGameState = gameState;
        document.body.className = `game pyramid levels-${gameState.settings.levels || 4}`;
        renderPlayerList(gameState.players, gameState);
        renderPyramid(gameState);
        renderPlayerHand(gameState);
        renderActionButtons(gameState);
        renderDrinksCounter(gameState);
        renderActionLog(gameState.actionLog);

        const currentAction = gameState.pendingActions && gameState.pendingActions[0];
        const isMyChallenge = currentAction && currentAction.target.uuid === user.uuid;

        if (isMyChallenge) {
            showChallengeModal(currentAction, gameState);
        } else {
            challengeModal.style.display = 'none';
        }
    }

    function renderActionButtons(gameState) {
        playerActionsElement.innerHTML = '';
        const { phase, playersFinishedThisRound, playerHands, pendingActions } = gameState;

        if (user.uuid === roomAdminId && phase === 'waiting') {
            const startBtn = document.createElement('button');
            startBtn.innerHTML = '<i class="bi bi-play-fill"></i> Empezar partida';
            startBtn.classList.add('btn-custom');
            startBtn.onclick = () => socket.emit('start-pyramid', { roomId, userId: user.uuid, levels: gameState.settings.levels });
            playerActionsElement.appendChild(startBtn);
            return;
        }

        if (user.uuid === roomAdminId && phase === 'finished') {
            const playAgainBtn = document.createElement('button');
            playAgainBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Jugar otra vez';
            playAgainBtn.classList.add('btn-custom');
            playAgainBtn.onclick = () => socket.emit('pyramid:reset-game', { roomId, userId: user.uuid });
            playerActionsElement.appendChild(playAgainBtn);
            return;
        }

        if (phase !== 'playing' || playersFinishedThisRound.includes(user.uuid) || pendingActions.length > 0) {
            return;
        }

        const myHand = playerHands[user.uuid];
        const canSendDrink = myHand && myHand.some(c => !c.used);

        if (canSendDrink) {
            const sendDrinkBtn = document.createElement('button');
            sendDrinkBtn.innerHTML = isSelectingCard ? '<i class="bi bi-hand-index-thumb"></i> Toca una carta' : '<i class="bi bi-cup-straw"></i> Mandar beber';
            sendDrinkBtn.classList.add('btn-small', 'btn-custom');
            if (isSelectingCard) sendDrinkBtn.classList.add('is-armed');
            sendDrinkBtn.onclick = () => {
                isSelectingCard = !isSelectingCard;
                updateUI(gameState); // Re-render to show selectable cards
            };
            playerActionsElement.appendChild(sendDrinkBtn);
        }

        const passBtn = document.createElement('button');
        passBtn.textContent = 'Pasar';
        passBtn.classList.add('btn-small', 'tp-btn', 'tp-btn--ghost');
        passBtn.onclick = () => socket.emit('pyramid:pass-turn', { roomId });
        playerActionsElement.appendChild(passBtn);
    }

    function renderPlayerHand(gameState) {
        playerHandElement.innerHTML = '';
        const myHand = gameState.playerHands[user.uuid];
        if (!myHand) { playerHandElement.dataset.size = '0'; return; }
        playerHandElement.classList.toggle('is-dealing', playerHandElement.dataset.size !== String(myHand.length));
        playerHandElement.dataset.size = String(myHand.length);

        myHand.forEach((cardData, index) => {
            const cardElement = createCardElement(cardData.card, true);
            if (cardData.used) {
                cardElement.classList.add('used-card');
            }

            cardElement.style.setProperty('--i', index);
            if (isSelectingCard && !cardData.used) {
                cardElement.classList.add('selectable');
                cardElement.setAttribute('role', 'button');
                cardElement.setAttribute('aria-label', 'Usar esta carta');
                cardElement.onclick = () => {
                    isSelectingCard = false;
                    showTargetModal(gameState.players, index);
                };
            }
            playerHandElement.appendChild(cardElement);
        });
    }

    function renderDrinksCounter(gameState) {
        const myTotalDrinks = gameState.drinksThisRound ? (gameState.drinksThisRound[user.uuid] || 0) : 0;
        myDrinksCount.innerHTML = myTotalDrinks > 0 ? `<span class="g-banner"><i class="bi bi-cup-straw"></i> Llevas ${myTotalDrinks} ${myTotalDrinks == 1 ? 'trago' : 'tragos'} esta ronda</span>` : '';
    }

    function showTargetModal(players, handCardIndex) {
        targetPlayerList.innerHTML = '';
        players.forEach(player => {
            if (player.uuid === user.uuid) return;
            const btn = document.createElement('button');
            btn.classList.add('target-btn');
            btn.appendChild(tpAvatar(player.name));
            const nm = document.createElement('span');
            nm.textContent = player.name;
            btn.appendChild(nm);
            const arrow = document.createElement('i');
            arrow.className = 'bi bi-chevron-right';
            btn.appendChild(arrow);
            btn.onclick = () => {
                socket.emit('pyramid:send-drink', { roomId, targetPlayerUuid: player.uuid, handCardIndex });
                targetModal.style.display = 'none';
            };
            targetPlayerList.appendChild(btn);
        });
        targetModal.style.display = 'flex';
    }

    cancelTargetBtn.onclick = () => {
        isSelectingCard = false;
        targetModal.style.display = 'none';
        socket.emit('roomState', { roomId }); // Request fresh state to re-render buttons
    };

    function showChallengeModal(action, gameState) {
        const pyramidCardWrapper = gameState.pyramid.flat()[gameState.currentCardIndex - 1];
        const level = gameState.pyramid.findIndex(row => row.includes(pyramidCardWrapper)) + 1;

        challengeTitle.textContent = `${action.sender.name} te manda beber`;
        challengeText.textContent = `Dice que tiene esta carta (piso ${level}). ¿Le crees?`;
        challengePyramidCard.innerHTML = '';
        challengePyramidCard.appendChild(createCardElement(pyramidCardWrapper.card, true));

        challengeAcceptBtn.innerHTML = `Bebo <span>${level} ${level == 1 ? 'trago' : 'tragos'}</span>`;
        challengeRejectBtn.innerHTML = `¡Mientes! <span>${level * 2} tragos si fallas</span>`;

        challengeAcceptBtn.onclick = () => socket.emit('pyramid:resolve-action', { roomId, resolution: 'accept' });
        challengeRejectBtn.onclick = () => socket.emit('pyramid:resolve-action', { roomId, resolution: 'challenge' });

        challengeModal.style.display = 'flex';
    }

    // --- Helper Functions ---
    function renderPlayerList(players, gameState) {
        playerList.innerHTML = '';
        if (!players) return;
        const drinks = (gameState && gameState.drinksThisRound) || {};
        const done = (gameState && gameState.playersFinishedThisRound) || [];
        players.forEach(p => {
            const n = drinks[p.uuid] || 0;
            const li = tpPlayerChip(p.name, { offline: p.online === false,
                me: p.uuid === user.uuid,
                meta: n > 0 ? String(n) : '',
                metaIcon: n > 0 ? 'bi-cup-straw' : null,
                className: done.includes(p.uuid) ? 'is-passed' : ''
            });
            playerList.appendChild(li);
        });
    }

    function renderPyramid(gameState) {
        pyramidArea.innerHTML = '';
        if (!gameState || !gameState.pyramid) return;
        
        const pyramid = gameState.pyramid;
        const activeFlatIndex = gameState.currentCardIndex - 1;
        const firstRender = revealedSeen === null;
        if (firstRender) revealedSeen = new Set();
        const dealNow = firstRender || (pyramidArea.dataset.phase === 'waiting' && gameState.phase !== 'waiting');
        pyramidArea.classList.toggle('is-dealing', dealNow);
        pyramidArea.dataset.phase = gameState.phase;
        const newlyRevealed = [];

        pyramid.forEach((row, rowIndex) => {
            const rowDiv = document.createElement('div');
            rowDiv.classList.add('pyramid-row');
            
            // Calculate starting flat index for this row to correctly identify the active card
            let rowStartFlatIndex = 0;
            for (let i = 0; i < rowIndex; i++) {
                rowStartFlatIndex += pyramid[i].length;
            }

            row.forEach((cardData, cardIndex) => {
                const currentFlatIndex = rowStartFlatIndex + cardIndex;
                const isNewReveal = cardData.revealed && !firstRender && !revealedSeen.has(currentFlatIndex);
                const cardElement = createCardElement(cardData.card, cardData.revealed && !isNewReveal);
                if (cardData.revealed) revealedSeen.add(currentFlatIndex);
                else revealedSeen.delete(currentFlatIndex);
                if (isNewReveal) newlyRevealed.push(cardElement);
                cardElement.style.setProperty('--i', currentFlatIndex);

                if (currentFlatIndex === activeFlatIndex && cardData.revealed) {
                    cardElement.classList.add('active-card');
                }
                
                rowDiv.appendChild(cardElement);
            });
            pyramidArea.appendChild(rowDiv);
        });
        if (gameState.phase === 'waiting') revealedSeen = new Set();
        if (newlyRevealed.length) {
            requestAnimationFrame(() => requestAnimationFrame(() => newlyRevealed.forEach(el => el.classList.add('revealed', 'just-revealed'))));
        }
    }

    function createCardElement(cardData, isFaceUp = false) {
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card');
        if (isFaceUp) cardDiv.classList.add('revealed');

        const cardInner = document.createElement('div');
        cardInner.classList.add('card-inner');

        const cardFront = document.createElement('div');
        cardFront.classList.add('card-front');
        cardFront.style.backgroundImage = `url('/images/cartas/${cardData.number}_${cardData.suit.toUpperCase()}.png')`;

        const cardBack = document.createElement('div');
        cardBack.classList.add('card-back');
        cardBack.style.backgroundImage = `url('/images/cartas/FIN.png')`;

        cardInner.appendChild(cardFront);
        cardInner.appendChild(cardBack);
        cardDiv.appendChild(cardInner);
        return cardDiv;
    }

    function renderActionLog(log) {
        actionsLog.innerHTML = '';
        if (!log) return;
        log.slice(-12).forEach(entry => {
            const p = document.createElement('p');
            p.textContent = String(entry).replace(/^\[Server\]\s*/, '');
            actionsLog.appendChild(p);
        });
        actionsLog.scrollTop = actionsLog.scrollHeight;
    }
});

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}