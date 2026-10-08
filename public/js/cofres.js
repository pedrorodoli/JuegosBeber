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
    const chestsGrid = document.getElementById('chests-grid');
    const turnOrderList = document.getElementById('turn-order-list');
    const adminPostGame = document.getElementById('admin-post-game');
    const resetGameBtn = document.getElementById('reset-game-btn');

    // Modal elements
    // Hoja de premio (sustituye al modal de Bootstrap)
    const rewardModalEl = document.getElementById('rewardModal');
    const rewardModal = {
        show() { rewardModalEl.style.display = 'flex'; const b = rewardModalEl.querySelector('button'); if (b) setTimeout(() => b.focus(), 50); },
        hide() { rewardModalEl.style.display = 'none'; }
    };
    rewardModalEl.addEventListener('click', (e) => {
        if (e.target === rewardModalEl || e.target.closest('[data-bs-dismiss]')) rewardModal.hide();
    });
    let openedSeen = null; // cofres ya abiertos (para animar solo los nuevos)
    const rewardText = document.getElementById('reward-text');
    const rewardDescription = document.getElementById('reward-description');
    const openedChestImg = document.getElementById('opened-chest-img');

    // Name modal
    const nameModal = document.getElementById('name-modal');
    const nameInput = document.getElementById('name-input');
    const joinGameBtn = document.getElementById('join-game-btn');

    let roomAdminId = null;
    let latestGameState = null;
    let chestPositions = {}; // Cache for random positions: { chestId: { top, left, width, height } }

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
        socket.emit('joinRoom', { gameType: 'cofres', roomId, user });
    }

    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGameBtn.click(); });
    joinGameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) joinRoom(name);
        else { nameInput.focus(); alert('Escribe tu nombre para entrar.'); }
    });

    if (user.name) {
        nameInput.value = user.name;
        joinRoom(user.name);
    } else {
        nameModal.style.display = 'flex';
    }

    // --- Socket Handlers ---
    socket.on('roomState', (gameState) => {
        latestGameState = gameState;
        // If we were in waiting and now playing, clear positions to re-randomize
        if (gameState.phase === 'waiting') {
            chestPositions = {};
            openedSeen = null;
        }
        updateUI(gameState);
    });

    socket.on('error', (err) => {
        alert(err.message);
    });

    // --- UI Logic ---
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

        // Admin controls
        if (state.roomAdminId === user.uuid) {
            if (state.phase === 'waiting') adminControls.classList.remove('d-none');
            else adminControls.classList.add('d-none');

            if (state.phase === 'finished') adminPostGame.classList.remove('d-none');
            else adminPostGame.classList.add('d-none');
        }
    }

    function renderWaitingRoom(state) {
        playerCount.textContent = state.players.length;
        playersList.innerHTML = '';
        state.players.forEach(p => {
            const li = tpPlayerChip(p.name, { offline: p.online === false,
                me: p.uuid === user.uuid,
                meta: p.uuid === state.roomAdminId ? 'anfitrión' : '',
                className: p.online ? '' : 'is-offline'
            });
            playersList.appendChild(li);
        });
    }

    function renderGameBoard(state) {
        // Turn indicator
        const currentPlayerUuid = state.turnOrder[state.currentPlayerIndex];
        const isMyTurn = currentPlayerUuid === user.uuid;
        const currentPlayer = state.players.find(p => p.uuid === currentPlayerUuid);

        if (state.phase === 'finished') {
            turnIndicator.textContent = 'Partida terminada';
            turnIndicator.className = 'is-finished';
        } else {
            turnIndicator.textContent = isMyTurn ? 'Te toca: elige un cofre' : `Turno de ${currentPlayer ? currentPlayer.name : '...'}`;
            turnIndicator.className = isMyTurn ? 'is-my-turn' : '';
        }

        // Last action
        if (state.lastAction) {
            lastActionContainer.classList.remove('d-none');
            const typeName = { normal: 'normal', large: 'grande', golden: 'dorado' }[state.lastAction.chestType] || state.lastAction.chestType;
            lastActionText.innerHTML = '';
            const ic = document.createElement('i'); ic.className = 'bi ' + getRewardIconClass(state.lastAction.reward);
            const tx = document.createElement('span'); tx.textContent = `${state.lastAction.playerName} abrió un cofre ${typeName}: ${getRewardText(state.lastAction.reward)}`;
            lastActionText.append(ic, tx);
        }

        // Chests
        chestsGrid.innerHTML = '';
        const firstPaint = openedSeen === null;
        if (firstPaint) openedSeen = new Set();
        state.chests.forEach((chest, idx) => {
            const justOpened = chest.opened && !firstPaint && !openedSeen.has(chest.id);
            if (chest.opened) openedSeen.add(chest.id);
            const chestEl = document.createElement('div');
            chestEl.className = `chest-container ${chest.type} ${chest.opened && !justOpened ? 'opened' : 'closed'} ${isMyTurn && !chest.opened ? 'clickable' : ''}`;
            chestEl.style.setProperty('--i', idx);
            if (justOpened) requestAnimationFrame(() => requestAnimationFrame(() => { chestEl.classList.remove('closed'); chestEl.classList.add('opened', 'just-opened'); }));
            
            // Apply percentages from server
            chestEl.style.top = `${chest.y}%`;
            chestEl.style.left = `${chest.x}%`;
            chestEl.style.setProperty('--x', chest.x);
            chestEl.style.setProperty('--y', chest.y);

            const chestInner = document.createElement('div');
            chestInner.className = 'chest-inner';
            
            const chestFront = document.createElement('div');
            chestFront.className = 'chest-front';
            chestFront.innerHTML = '<span class="chest-lid"></span><span class="chest-body"></span><span class="chest-lock"></span>';

            const chestOpen = document.createElement('div');
            chestOpen.className = 'chest-open';
            if (chest.opened) {
                chestOpen.innerHTML = `<div class="reward-icon"><i class="bi ${getRewardIconClass(chest.reward)}"></i></div>`;
                chestOpen.dataset.reward = chest.reward ? chest.reward.type : '';
            }

            chestInner.appendChild(chestFront);
            chestInner.appendChild(chestOpen);
            chestEl.appendChild(chestInner);

            if (isMyTurn && !chest.opened) {
                chestEl.setAttribute('role', 'button');
                chestEl.setAttribute('aria-label', `Abrir cofre ${chest.type}`);
                chestEl.addEventListener('click', () => {
                    socket.emit('cofres:openChest', { roomId, userId: user.uuid, chestId: chest.id });
                    showRewardModal(chest.reward, chest.type);
                });
            }

            chestsGrid.appendChild(chestEl);
        });

        // Turn order
        turnOrderList.innerHTML = '';
        state.turnOrder.forEach((uuid, index) => {
            const p = state.players.find(player => player.uuid === uuid);
            if (p) {
                const badge = tpPlayerChip(p.name, { offline: p.online === false, tag: 'span', turn: index === state.currentPlayerIndex && state.phase !== 'finished', me: p.uuid === user.uuid });
                turnOrderList.appendChild(badge);
            }
        });
    }

    function getRewardText(reward) {
        switch (reward.type) {
            case 'BEBE': return `Bebe ${reward.value} ${reward.value == 1 ? 'trago' : 'tragos'}`;
            case 'REPARTE': return `Reparte ${reward.value} ${reward.value == 1 ? 'trago' : 'tragos'}`;
            case 'ACABATE': return 'Se acaba la bebida';
            case 'MANDA_ACABAR': return 'Manda acabar una bebida';
            default: return 'Premio desconocido';
        }
    }

    function getRewardIconClass(reward) {
        switch (reward && reward.type) {
            case 'BEBE': return 'bi-cup-straw';
            case 'REPARTE': return 'bi-gift-fill';
            case 'ACABATE': return 'bi-hourglass-bottom';
            case 'MANDA_ACABAR': return 'bi-hand-index-thumb-fill';
            default: return 'bi-question-lg';
        }
    }

    function getRewardIcon(reward) {
        switch (reward.type) {
            case 'BEBE': return '🍺';
            case 'REPARTE': return '🎁';
            case 'ACABATE': return '💀';
            case 'MANDA_ACABAR': return '👑';
            default: return '❓';
        }
    }

    function showRewardModal(reward, type) {
        rewardText.textContent = getRewardText(reward);
        openedChestImg.className = `chest-img-modal ${type}`;
        openedChestImg.innerHTML = `<i class="bi ${getRewardIconClass(reward)}"></i>`;
        
        let desc = '';
        if (reward.type === 'BEBE') desc = '¡Salud! Te toca beber.';
        else if (reward.type === 'REPARTE') desc = 'Elige a alguien para que beba.';
        else if (reward.type === 'ACABATE') desc = '¡Venga ese hidalgo! Toda la bebida fuera.';
        else if (reward.type === 'MANDA_ACABAR') desc = 'Elige a un afortunado para que se acabe su bebida.';
        
        rewardDescription.textContent = desc;
        rewardModal.show();
    }

    // --- Event Listeners ---
    startGameBtn.addEventListener('click', () => {
        socket.emit('cofres:startGame', { roomId, userId: user.uuid });
    });

    resetGameBtn.addEventListener('click', () => {
        socket.emit('cofres:resetGame', { roomId, userId: user.uuid });
    });

    window.addEventListener('resize', () => {
        // (clon) calculateChestPositions no existía y lanzaba un error al redimensionar; las posiciones vienen del servidor
        if (latestGameState && latestGameState.phase !== 'waiting') {
            renderGameBoard(latestGameState);
        }
    });
});