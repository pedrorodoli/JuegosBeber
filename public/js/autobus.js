document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Game elements
    const autobusArea = document.getElementById('autobus-area');
    const playerHandElement = document.getElementById('player-hand');
    const playerActionsElement = document.getElementById('player-actions');
    const playerList = document.getElementById('player-list');
    const myDrinksCount = document.getElementById('my-drinks-count');

    // Modal elements
    const nameModal = document.getElementById('name-modal');
    const nameInput = document.getElementById('name-input');
    const joinGameBtn = document.getElementById('join-game-btn');

    let user = {
        uuid: localStorage.getItem('userUUID') || uuidv4(),
        name: localStorage.getItem('userName') || 'Anónimo'
    };
    localStorage.setItem('userUUID', user.uuid);

    const roomId = window.location.pathname.split('/').pop();
    let roomAdminId = null;
    let latestGameState = null;
    let lastRevealedKey = null;   // para girar solo las cartas nuevas
    let lastHandKey = '';         // para repartir solo las cartas nuevas

    // --- Join Logic ---
    function joinGame(name) {
        user.name = name;
        localStorage.setItem('userName', user.name);
        nameModal.style.display = 'none';
        socket.emit('joinRoom', { gameType: 'autobus', roomId, user });
    }

    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGameBtn.click(); });

    joinGameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) return alert('Por favor, introduce un nombre.');
        joinGame(name);
    });

    // Auto-join if name exists
    if (localStorage.getItem('userName')) {
        nameInput.value = localStorage.getItem('userName');
        joinGame(localStorage.getItem('userName'));
    } else {
        nameModal.style.display = 'flex';
    }

    // --- Socket Handlers ---
    socket.on('roomState', (gameState) => {
        latestGameState = gameState; // Always update the latest game state
        console.log('New Game State:', latestGameState);
        roomAdminId = latestGameState.roomAdminId;
        updateUI(latestGameState); // Update UI immediately for all clients
    });

    socket.on('error', (error) => alert(`Error: ${error.message}`));

    // --- UI Rendering ---
    function updateUI(gameState) {
        renderSteps(gameState);
        renderPlayerList(gameState);
        renderAutobus(gameState);
        renderPlayerHand(gameState);
        renderActionButtons(gameState);
        renderDrinksCounter(gameState);

        // Display messages
        const myPlayer = gameState.players.find(p => p.uuid === user.uuid);
        if (myPlayer && myPlayer.message) {
            Toastify({
                text: myPlayer.message,
                duration: 3000,
                gravity: "top",
                position: "center",
                className: /fallado|bebes/i.test(myPlayer.message) ? 'tp-toast--drink' : ''
            }).showToast();
        }
    }

    function renderAutobus(gameState) {
        autobusArea.innerHTML = '';
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];

        let question = '';
        switch (gameState.phase) {
            case 'red-or-black':
                question = '¿Rojo o Negro?';
                break;
            case 'higher-or-lower':
                question = '¿Mayor o Menor?';
                break;
            case 'inside-or-outside':
                question = '¿Dentro o Fuera?';
                break;
            case 'suit-guess':
                question = '¿Cuál es el palo de la última carta?';
                break;
            case 'waiting':
                question = 'Esperando a que el administrador inicie la partida...';
                break;
            case 'finished':
                question = '¡Juego Terminado!';
                break;
        }

        const questionElement = document.createElement('h2');
        questionElement.className = 'g-question';
        questionElement.textContent = question;
        if (currentPlayer && gameState.phase !== 'waiting' && gameState.phase !== 'finished') {
            const who = document.createElement('p');
            who.className = 'g-sub';
            who.textContent = currentPlayer.uuid === user.uuid ? 'Te toca' : `Turno de ${currentPlayer.name}`;
            autobusArea.appendChild(questionElement);
            autobusArea.appendChild(who);
        }
        if (!questionElement.parentNode) autobusArea.appendChild(questionElement);

        const cardDisplayContainer = document.createElement('div');
        cardDisplayContainer.classList.add('card-display-container');

        const deckCardElement = createCardElement({ rank: 'BACK', suit: 'BACK' }, false);
        deckCardElement.classList.add('deck-card');
        cardDisplayContainer.appendChild(deckCardElement);

        const revealedCardSlot = document.createElement('div');
        revealedCardSlot.classList.add('revealed-card-slot');
        if (gameState.currentCard) {
            const key = `${gameState.currentCard.rank}_${gameState.currentCard.suit}_${gameState.currentPlayerIndex}_${gameState.phase}`;
            const isNew = key !== lastRevealedKey;
            lastRevealedKey = key;
            const cardElement = createCardElement(gameState.currentCard, !isNew);
            revealedCardSlot.appendChild(cardElement);
            revealedCardSlot.classList.add('has-card');
            if (isNew) {
                cardElement.classList.add('is-drawn');
                requestAnimationFrame(() => requestAnimationFrame(() => cardElement.classList.add('revealed')));
            }
        } else {
            lastRevealedKey = null;
            const placeholderCard = document.createElement('div');
            placeholderCard.classList.add('card');
            placeholderCard.innerHTML = '<div class="card-inner"><div class="card-front"></div><div class="card-back"></div></div>';
            revealedCardSlot.appendChild(placeholderCard);
        }
        cardDisplayContainer.appendChild(revealedCardSlot);

        autobusArea.appendChild(cardDisplayContainer);
    }

    function renderActionButtons(gameState) {
        playerActionsElement.innerHTML = ''; // Always clear first

        // If a card is currently revealed, it means we are showing the result of a turn.
        // Do not show any action buttons.
        if (gameState.currentCard) {
            playerActionsElement.style.display = 'none';
            return;
        }

        const { phase, players, currentPlayerIndex } = gameState;
        const currentPlayer = players[currentPlayerIndex];
        const isMyTurn = currentPlayer && currentPlayer.uuid === user.uuid;

        let buttonsRendered = false; // Flag to track if any buttons were rendered

        function addClickListener(element, eventData) {
            element.addEventListener('click', () => {
                socket.emit(eventData.type, eventData.payload);
            });
        }

        // Admin buttons
        if (user.uuid === roomAdminId) {
            if (phase === 'waiting') {
                const startBtn = document.createElement('button');
                startBtn.innerHTML = '<i class="bi bi-play-fill"></i> Empezar partida';
                startBtn.classList.add('btn-custom');
                addClickListener(startBtn, { type: 'start-autobus', payload: { roomId, userId: user.uuid } });
                playerActionsElement.appendChild(startBtn);
                buttonsRendered = true;
            } else if (phase === 'finished') {
                const playAgainBtn = document.createElement('button');
                playAgainBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Jugar otra vez';
                playAgainBtn.classList.add('btn-custom');
                addClickListener(playAgainBtn, { type: 'resetGame', payload: { roomId, userId: user.uuid, gameType: 'autobus' } });
                playerActionsElement.appendChild(playAgainBtn);
                buttonsRendered = true;
            }
        }

        // Player action buttons
        if (isMyTurn && !(currentPlayer && currentPlayer.hasWon)) {
            switch (phase) {
                case 'red-or-black':
                    const redBtn = document.createElement('button');
                    redBtn.innerHTML = '<i class="bi bi-suit-heart-fill"></i> Rojo';
                    redBtn.classList.add('btn-custom', 'bus-choice', 'is-red');
                    addClickListener(redBtn, { type: 'autobus:red-or-black', payload: { roomId, userId: user.uuid, guess: 'red' } });
                    playerActionsElement.appendChild(redBtn);

                    const blackBtn = document.createElement('button');
                    blackBtn.innerHTML = '<i class="bi bi-suit-spade-fill"></i> Negro';
                    blackBtn.classList.add('btn-custom', 'bus-choice', 'is-black');
                    addClickListener(blackBtn, { type: 'autobus:red-or-black', payload: { roomId, userId: user.uuid, guess: 'black' } });
                    playerActionsElement.appendChild(blackBtn);
                    buttonsRendered = true;
                    break;
                case 'higher-or-lower':
                    const higherBtn = document.createElement('button');
                    higherBtn.innerHTML = '<i class="bi bi-arrow-up"></i> Mayor';
                    higherBtn.classList.add('btn-custom', 'bus-choice');
                    addClickListener(higherBtn, { type: 'autobus:higher-or-lower', payload: { roomId, userId: user.uuid, guess: 'higher' } });
                    playerActionsElement.appendChild(higherBtn);

                    const lowerBtn = document.createElement('button');
                    lowerBtn.innerHTML = '<i class="bi bi-arrow-down"></i> Menor';
                    lowerBtn.classList.add('btn-custom', 'bus-choice');
                    addClickListener(lowerBtn, { type: 'autobus:higher-or-lower', payload: { roomId, userId: user.uuid, guess: 'lower' } });
                    playerActionsElement.appendChild(lowerBtn);
                    buttonsRendered = true;
                    break;
                case 'inside-or-outside':
                    const insideBtn = document.createElement('button');
                    insideBtn.innerHTML = '<i class="bi bi-arrows-angle-contract"></i> Dentro';
                    insideBtn.classList.add('btn-custom', 'bus-choice');
                    addClickListener(insideBtn, { type: 'autobus:inside-or-outside', payload: { roomId, userId: user.uuid, guess: 'inside' } });
                    playerActionsElement.appendChild(insideBtn);

                    const outsideBtn = document.createElement('button');
                    outsideBtn.innerHTML = '<i class="bi bi-arrows-angle-expand"></i> Fuera';
                    outsideBtn.classList.add('btn-custom', 'bus-choice');
                    addClickListener(outsideBtn, { type: 'autobus:inside-or-outside', payload: { roomId, userId: user.uuid, guess: 'outside' } });
                    playerActionsElement.appendChild(outsideBtn);
                    buttonsRendered = true;
                    break;
                case 'suit-guess':
                    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
                    const suitNames = { 'hearts': 'Corazones', 'diamonds': 'Diamantes', 'clubs': 'Tréboles', 'spades': 'Picas' };
                    
                    const buttonGrid = document.createElement('div');
                    buttonGrid.className = 'suit-grid';
                    const suitIcons = { 'hearts': 'bi-suit-heart-fill', 'diamonds': 'bi-suit-diamond-fill', 'clubs': 'bi-suit-club-fill', 'spades': 'bi-suit-spade-fill' };

                    suits.forEach(suit => {
                        const suitBtn = document.createElement('button');
                        suitBtn.innerHTML = `<i class="bi ${suitIcons[suit]}"></i> ${suitNames[suit]}`;
                        suitBtn.classList.add('btn-custom', 'btn-small', 'bus-choice', (suit === 'hearts' || suit === 'diamonds') ? 'is-red' : 'is-black');
                        addClickListener(suitBtn, { type: 'autobus:suit-guess', payload: { roomId, userId: user.uuid, guess: suit } });
                        buttonGrid.appendChild(suitBtn);
                    });
                    playerActionsElement.appendChild(buttonGrid);
                    buttonsRendered = true;
                    break;
            }
        }

        if (buttonsRendered) {
            playerActionsElement.style.display = 'flex';
        } else {
            playerActionsElement.style.display = 'none';
        }
    }

    function renderPlayerHand(gameState) {
        playerHandElement.innerHTML = '';
        const me = gameState.players.find(p => p.uuid === user.uuid);
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        const isMyTurn = currentPlayer && currentPlayer.uuid === user.uuid;

        const playerToShow = isMyTurn ? me : currentPlayer;

        if (!playerToShow || !playerToShow.currentCards) { lastHandKey = ''; return; }

        const handTitle = document.querySelector('.player-footer h2');
        if (handTitle) {
            handTitle.textContent = isMyTurn ? 'Tus cartas' : `Cartas de ${currentPlayer.name}`;
        }

        const ownerKey = playerToShow.uuid + ':';
        const prevCount = lastHandKey.startsWith(ownerKey) ? Number(lastHandKey.slice(ownerKey.length)) : -1;
        playerToShow.currentCards.forEach((cardData, i) => {
            const cardElement = createCardElement(cardData, true);
            if (prevCount >= 0 && i >= prevCount) cardElement.classList.add('is-dealt');
            playerHandElement.appendChild(cardElement);
        });
        if (playerToShow.currentCards.length === 0) {
            for (let i = 0; i < 4; i++) {
                const slot = document.createElement('div');
                slot.className = 'hand-slot';
                playerHandElement.appendChild(slot);
            }
        }
        lastHandKey = ownerKey + playerToShow.currentCards.length;
    }

    function renderDrinksCounter(gameState) {
        const myPlayer = gameState.players.find(p => p.uuid === user.uuid);
        // Show drinks message only if the player has a failure message
        if (myPlayer && myPlayer.message && myPlayer.message.includes('fallado')) {
            myDrinksCount.innerHTML = `<span class="g-banner"><i class="bi bi-cup-straw"></i> Bebes ${myPlayer.drinksToTake} ${myPlayer.drinksToTake == 1 ? 'trago' : 'tragos'}</span>`;
        } else {
            myDrinksCount.textContent = '';
        }
    }

    function renderSteps(gameState) {
        const steps = document.getElementById('bus-steps');
        if (!steps) return;
        const order = ['red-or-black', 'higher-or-lower', 'inside-or-outside', 'suit-guess'];
        const idx = order.indexOf(gameState.phase);
        steps.classList.toggle('is-idle', idx === -1);
        steps.querySelectorAll('li').forEach((li, i) => {
            li.classList.toggle('is-done', idx > -1 && i < idx);
            li.classList.toggle('is-current', i === idx);
        });
    }

    // --- Helper Functions ---
    function renderPlayerList(gameState) {
        playerList.innerHTML = '';
        if (!gameState.players) return;
        const currentPlayerId = gameState.players[gameState.currentPlayerIndex].uuid;

        gameState.players.forEach(p => {
            const drinks = p.totalDrinks || 0;
            const li = tpPlayerChip(p.name, { offline: p.online === false,
                turn: p.uuid === currentPlayerId && gameState.phase !== 'waiting' && gameState.phase !== 'finished',
                won: p.hasWon,
                me: p.uuid === user.uuid,
                meta: p.hasWon ? 'bajado' : String(drinks),
                metaIcon: p.hasWon ? 'bi-check2' : 'bi-cup-straw'
            });
            if (p.uuid === currentPlayerId) li.classList.add('current-player');
            if (p.hasWon) li.classList.add('player-won');
            playerList.appendChild(li);
        });
        tpScrollTurnIntoView(playerList);
    }

    function createCardElement(cardData, isFaceUp = false) {
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('card');
        if (isFaceUp) cardDiv.classList.add('revealed');

        const cardInner = document.createElement('div');
        cardInner.classList.add('card-inner');

        const cardFront = document.createElement('div');
        cardFront.classList.add('card-front');
        
        let rankForImage = cardData.rank;
        if (cardData.rank === 'J') rankForImage = 'jack';
        else if (cardData.rank === 'Q') rankForImage = 'queen';
        else if (cardData.rank === 'K') rankForImage = 'king';
        else if (cardData.rank === 'A') rankForImage = 'ace';

        const cardImageName = cardData.rank === 'BACK' ? 'BACK' : `${rankForImage}_of_${cardData.suit}`.toLowerCase();
        const imagePath = `/images/cartasPoker/${cardImageName}.png`;
        cardFront.style.backgroundImage = `url('${imagePath}')`;

        const cardBack = document.createElement('div');
        cardBack.classList.add('card-back');
        cardBack.style.backgroundImage = `url('/images/cartasPoker/BACK.png')`;

        cardInner.appendChild(cardFront);
        cardInner.appendChild(cardBack);
        cardDiv.appendChild(cardInner);
        return cardDiv;
    }

    function uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
});