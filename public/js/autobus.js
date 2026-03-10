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

    let user = {};
    const roomId = window.location.pathname.split('/').pop();
    let roomAdminId = null;
    let latestGameState = null; // To store the latest game state for delayed updates

    // --- Join Logic ---
    joinGameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) return alert('Por favor, introduce un nombre.');
        user = { uuid: localStorage.getItem('userUuid') || uuidv4(), name };
        localStorage.setItem('userUuid', user.uuid);
        localStorage.setItem('userName', user.name);
        nameModal.style.display = 'none';
        socket.emit('joinRoom', { gameType: 'autobus', roomId, user });
        if (latestGameState) {
            updateUI(latestGameState);
        }
    });

    if (localStorage.getItem('userName')) {
        nameInput.value = localStorage.getItem('userName');
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
                style: {
                    background: "linear-gradient(to right, #ff416c, #ff4b2b)",
                    zIndex: 9999
                }
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
        questionElement.textContent = question;
        autobusArea.appendChild(questionElement);

        const cardDisplayContainer = document.createElement('div');
        cardDisplayContainer.classList.add('card-display-container');

        const deckCardElement = createCardElement({ rank: 'BACK', suit: 'BACK' }, false);
        deckCardElement.classList.add('deck-card');
        cardDisplayContainer.appendChild(deckCardElement);

        const revealedCardSlot = document.createElement('div');
        revealedCardSlot.classList.add('revealed-card-slot');
        if (gameState.currentCard) {
            const cardElement = createCardElement(gameState.currentCard, true);
            revealedCardSlot.appendChild(cardElement);
        } else {
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
                startBtn.textContent = 'Comenzar Partida';
                startBtn.classList.add('btn-custom');
                addClickListener(startBtn, { type: 'start-autobus', payload: { roomId, userId: user.uuid } });
                playerActionsElement.appendChild(startBtn);
                buttonsRendered = true;
            } else if (phase === 'finished') {
                const playAgainBtn = document.createElement('button');
                playAgainBtn.textContent = 'Volver a Jugar';
                playAgainBtn.classList.add('btn-custom');
                addClickListener(playAgainBtn, { type: 'autobus:reset-game', payload: { roomId, userId: user.uuid } });
                playerActionsElement.appendChild(playAgainBtn);
                buttonsRendered = true;
            }
        }

        // Player action buttons
        if (isMyTurn && !(currentPlayer && currentPlayer.hasWon)) {
            switch (phase) {
                case 'red-or-black':
                    const redBtn = document.createElement('button');
                    redBtn.textContent = 'Rojo';
                    redBtn.classList.add('btn-custom');
                    addClickListener(redBtn, { type: 'autobus:red-or-black', payload: { roomId, userId: user.uuid, guess: 'red' } });
                    playerActionsElement.appendChild(redBtn);

                    const blackBtn = document.createElement('button');
                    blackBtn.textContent = 'Negro';
                    blackBtn.classList.add('btn-custom');
                    addClickListener(blackBtn, { type: 'autobus:red-or-black', payload: { roomId, userId: user.uuid, guess: 'black' } });
                    playerActionsElement.appendChild(blackBtn);
                    buttonsRendered = true;
                    break;
                case 'higher-or-lower':
                    const higherBtn = document.createElement('button');
                    higherBtn.textContent = 'Mayor';
                    higherBtn.classList.add('btn-custom');
                    addClickListener(higherBtn, { type: 'autobus:higher-or-lower', payload: { roomId, userId: user.uuid, guess: 'higher' } });
                    playerActionsElement.appendChild(higherBtn);

                    const lowerBtn = document.createElement('button');
                    lowerBtn.textContent = 'Menor';
                    lowerBtn.classList.add('btn-custom');
                    addClickListener(lowerBtn, { type: 'autobus:higher-or-lower', payload: { roomId, userId: user.uuid, guess: 'lower' } });
                    playerActionsElement.appendChild(lowerBtn);
                    buttonsRendered = true;
                    break;
                case 'inside-or-outside':
                    const insideBtn = document.createElement('button');
                    insideBtn.textContent = 'Dentro';
                    insideBtn.classList.add('btn-custom');
                    addClickListener(insideBtn, { type: 'autobus:inside-or-outside', payload: { roomId, userId: user.uuid, guess: 'inside' } });
                    playerActionsElement.appendChild(insideBtn);

                    const outsideBtn = document.createElement('button');
                    outsideBtn.textContent = 'Fuera';
                    outsideBtn.classList.add('btn-custom');
                    addClickListener(outsideBtn, { type: 'autobus:inside-or-outside', payload: { roomId, userId: user.uuid, guess: 'outside' } });
                    playerActionsElement.appendChild(outsideBtn);
                    buttonsRendered = true;
                    break;
                case 'suit-guess':
                    const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
                    const suitNames = { 'hearts': 'Corazones', 'diamonds': 'Diamantes', 'clubs': 'Tréboles', 'spades': 'Picas' };
                    
                    const buttonGrid = document.createElement('div');
                    buttonGrid.style.display = 'grid';
                    buttonGrid.style.gridTemplateColumns = '1fr 1fr';
                    buttonGrid.style.gap = '10px';
                    buttonGrid.style.width = '100%';
                    buttonGrid.style.maxWidth = '250px';

                    suits.forEach(suit => {
                        const suitBtn = document.createElement('button');
                        suitBtn.textContent = suitNames[suit];
                        suitBtn.classList.add('btn-custom', 'btn-small');
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

        if (!playerToShow || !playerToShow.currentCards) return;

        const handTitle = document.querySelector('.player-footer h2');
        if (handTitle) {
            handTitle.textContent = isMyTurn ? 'Tus Cartas' : `Cartas de ${currentPlayer.name}`;
        }

        playerToShow.currentCards.forEach(cardData => {
            const cardElement = createCardElement(cardData, true);
            playerHandElement.appendChild(cardElement);
        });
    }

    function renderDrinksCounter(gameState) {
        const myPlayer = gameState.players.find(p => p.uuid === user.uuid);
        // Show drinks message only if the player has a failure message
        if (myPlayer && myPlayer.message && myPlayer.message.includes('fallado')) {
            myDrinksCount.textContent = `¡Bebes ${myPlayer.drinksToTake} trago(s)!`;
        } else {
            myDrinksCount.textContent = '';
        }
    }

    // --- Helper Functions ---
    function renderPlayerList(gameState) {
        playerList.innerHTML = '';
        if (!gameState.players) return;
        const currentPlayerId = gameState.players[gameState.currentPlayerIndex].uuid;

        gameState.players.forEach(p => {
            const li = document.createElement('li');
            li.textContent = `${p.name} (${p.totalDrinks || 0} tragos)`;
            if (p.uuid === currentPlayerId) {
                li.classList.add('current-player');
            }
            if (p.hasWon) {
                li.classList.add('player-won');
            }
            playerList.appendChild(li);
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