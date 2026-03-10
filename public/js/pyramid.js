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

    // --- Join Logic ---
    joinGameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) return alert('Por favor, introduce un nombre.');
        user = { uuid: localStorage.getItem('userUuid') || uuidv4(), name };
        localStorage.setItem('userUuid', user.uuid);
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
            style: {
                background: "linear-gradient(to right, #ff416c, #ff4b2b)",
                zIndex: 9999
            }
        }).showToast();
    });

    // --- UI Rendering ---
    function updateUI(gameState) {
        document.body.className = `levels-${gameState.settings.levels || 4}`;
        renderPlayerList(gameState.players);
        renderPyramid(gameState.pyramid);
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
            startBtn.textContent = 'Comenzar Partida';
            startBtn.classList.add('btn-custom');
            startBtn.onclick = () => socket.emit('start-pyramid', { roomId, userId: user.uuid, levels: gameState.settings.levels });
            playerActionsElement.appendChild(startBtn);
            return;
        }

        if (user.uuid === roomAdminId && phase === 'finished') {
            const playAgainBtn = document.createElement('button');
            playAgainBtn.textContent = 'Volver a Jugar';
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
            sendDrinkBtn.textContent = 'Mandar Beber';
            sendDrinkBtn.classList.add('btn-small');
            sendDrinkBtn.onclick = () => {
                isSelectingCard = true;
                updateUI(gameState); // Re-render to show selectable cards
            };
            playerActionsElement.appendChild(sendDrinkBtn);
        }

        const passBtn = document.createElement('button');
        passBtn.textContent = 'Pasar';
        passBtn.classList.add('btn-small');
        passBtn.onclick = () => socket.emit('pyramid:pass-turn', { roomId });
        playerActionsElement.appendChild(passBtn);
    }

    function renderPlayerHand(gameState) {
        playerHandElement.innerHTML = '';
        const myHand = gameState.playerHands[user.uuid];
        if (!myHand) return;

        myHand.forEach((cardData, index) => {
            const cardElement = createCardElement(cardData.card, true);
            if (cardData.used) {
                cardElement.classList.add('used-card');
            }

            if (isSelectingCard && !cardData.used) {
                cardElement.classList.add('selectable');
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
        myDrinksCount.textContent = myTotalDrinks > 0 ? `Tienes ${myTotalDrinks} trago(s) esta ronda` : '';
    }

    function showTargetModal(players, handCardIndex) {
        targetPlayerList.innerHTML = '';
        players.forEach(player => {
            if (player.uuid === user.uuid) return;
            const btn = document.createElement('button');
            btn.textContent = player.name;
            btn.classList.add('btn-custom');
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

        challengeTitle.textContent = `¡${action.sender.name} te manda a beber!`;
        challengeText.textContent = `Carta de la pirámide actual (Nivel ${level}):`;
        challengePyramidCard.innerHTML = '';
        challengePyramidCard.appendChild(createCardElement(pyramidCardWrapper.card, true));

        challengeAcceptBtn.innerHTML = `Beber <span>(${level} trago/s)</span>`;
        challengeRejectBtn.innerHTML = `Desafiar <span>(${level * 2} tragos si pierdes)</span>`;

        challengeAcceptBtn.onclick = () => socket.emit('pyramid:resolve-action', { roomId, resolution: 'accept' });
        challengeRejectBtn.onclick = () => socket.emit('pyramid:resolve-action', { roomId, resolution: 'challenge' });

        challengeModal.style.display = 'flex';
    }

    // --- Helper Functions ---
    function renderPlayerList(players) {
        playerList.innerHTML = '';
        if (!players) return;
        players.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.name;
            playerList.appendChild(li);
        });
    }

    function renderPyramid(pyramid) {
        pyramidArea.innerHTML = '';
        if (!pyramid) return;
        pyramid.slice().reverse().forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.classList.add('pyramid-row');
            row.forEach(cardData => {
                rowDiv.appendChild(createCardElement(cardData.card, cardData.revealed));
            });
            pyramidArea.appendChild(rowDiv);
        });
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
        log.forEach(entry => {
            const p = document.createElement('p');
            p.textContent = entry;
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