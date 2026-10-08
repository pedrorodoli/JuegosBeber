document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Extract roomId from URL
    const roomId = window.location.pathname.split('/').pop();
    if (!roomId) {
        console.error('[Lamente-Client] Room ID not found in URL');
        return;
    }

    // Get user info from localStorage
    let userUUID = localStorage.getItem('userUUID');
    let userName = localStorage.getItem('userName'); // General player name

    // If userUUID is not found, generate one and store it
    if (!userUUID) {
        userUUID = crypto.randomUUID();
        localStorage.setItem('userUUID', userUUID);
        console.log(`[Lamente-Client] Generated new userUUID: ${userUUID}`);
    } else {
        console.log(`[Lamente-Client] Found existing userUUID: ${userUUID}`);
    }
    
    // Elements from the DOM
    const loginScreen = document.getElementById('login-screen');
    const waitingScreen = document.getElementById('waiting-screen');
    const gameScreen = document.getElementById('game-screen');
    const gameOverScreen = document.getElementById('game-over-screen'); // Corrected ID

    const nameInput = document.getElementById('name-input');
    const joinButton = document.getElementById('join-button');
    const playerListDiv = document.getElementById('player-list');

    const countdownTimer = document.getElementById('countdown-timer');
    const playerNumberSpan = document.getElementById('player-number');
    const gameInfoDiv = document.getElementById('game-info');
    let lastGuesserDisplay = document.getElementById('last-guesser-display');
    if (!lastGuesserDisplay && gameInfoDiv) {
        lastGuesserDisplay = document.createElement('div');
        lastGuesserDisplay.id = 'last-guesser-display';
        lastGuesserDisplay.className = 'last-guesser-display'; // Add a class for styling
        // Insert it right after the game-info div
        gameInfoDiv.parentNode.insertBefore(lastGuesserDisplay, gameInfoDiv.nextSibling);
    }
    const voyButton = document.getElementById('voy-button');

    const gameOverTitle = document.getElementById('game-over-title');
    const gameOverReason = document.getElementById('game-over-reason');
    const resultsList = document.getElementById('results-list');
    const nextGameCountdownEl = document.getElementById('next-game-countdown');

    function lmInfo(min, max, remaining) {
        return `<span><small>Rango</small><strong class="num">${Number(min)}–${Number(max)}</strong></span><span><small>Faltan</small><strong class="num">${Number(remaining)}</strong></span>`;
    }

    // --- Helper to show screens ---
    function showScreen(screenName) {
        console.log(`[Lamente-Client] Showing screen: ${screenName}`);
        // (clon) Ocultamos solo las otras pantallas: la visible no se toca y no re-anima (parpadeo)
        const targetScreen = document.getElementById(`${screenName}-screen`);
        [loginScreen, waitingScreen, gameScreen, gameOverScreen].forEach(sc => { if (sc && sc !== targetScreen) sc.classList.add('hidden'); });
        if (targetScreen) {
            targetScreen.classList.remove('hidden');
        } else {
            console.error(`[Lamente-Client] Target screen '${screenName}-screen' not found in DOM!`);
        }
    }

    // --- Initial Join Logic ---
    // Handle the nuanced requirement of when to ask for a name.
    const isPlayAgain = sessionStorage.getItem('isPlayAgain') === 'true';
    const isAdminNavigatingToGame = sessionStorage.getItem('isAdminNavigatingToGame') === 'true'; // NEW: Get admin flag

    userName = localStorage.getItem('userName');

    // The 'isPlayAgain' and 'isAdminNavigatingToGame' flags are one-time flags. Consume them now.
    if (isPlayAgain) {
        sessionStorage.removeItem('isPlayAgain');
    }
    if (isAdminNavigatingToGame) { // NEW: Clear admin flag
        sessionStorage.removeItem('isAdminNavigatingToGame');
    }

    // Auto-join if it's a "Play Again" reload (for players) OR if an Admin is navigating to the game.
    if (userName && (isPlayAgain || isAdminNavigatingToGame)) { // Modified condition
        console.log(`[Lamente-Client] Auto-joining for: ${isPlayAgain ? 'Play Again' : 'Admin navigation'}.`);
        nameInput.value = userName;
        socket.emit('joinRoom', { gameType: 'lamente', roomId, user: { uuid: userUUID, name: userName } });
    } else {
        // For all other cases (first visit, regular revisit), show the login screen.
        console.log(`[Lamente-Client] New session or regular visit. Showing login screen.`);
        if (userName) {
            nameInput.value = userName; // Pre-fill with previous name but still require confirmation
        }
        showScreen('login');
    }

    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinButton.click(); });

    // Event listener for the join button, for new users or users changing their name.
    joinButton.addEventListener('click', () => {
        const enteredName = nameInput.value.trim();
        if (enteredName) {
            // Save the entered name and join the room.
            localStorage.setItem('userName', enteredName);
            userName = enteredName;

            console.log(`[Lamente-Client] Join button clicked. Joining with name '${userName}'.`);
            socket.emit('joinRoom', { gameType: 'lamente', roomId, user: { uuid: userUUID, name: userName } });
            // The 'roomState' event will now handle moving to the 'waiting' screen.
        } else {
            nameInput.focus();
            alert('Escribe tu nombre para entrar.');
        }
    });

    socket.on('error', (data) => {
        console.error(`[Lamente-Client] Server error: ${data.message}`);
        alert(`Error: ${data.message}`);
        localStorage.removeItem('userUUID');
        localStorage.removeItem('userName');
        window.location.reload();
    });

    // --- Game State Updates (from roomState) ---
    socket.on('roomState', (roomState) => {
        const gameState = roomState;
        window.gameState = gameState;
        console.log(`[Lamente-Client] Received roomState. Phase: ${gameState.phase}, AdminId: ${gameState.roomAdminId}, CurrentUserUUID: ${userUUID}, Players: ${gameState.players.map(p => p.name + (p.number !== null ? '(' + p.number + ')' : '')).join(', ')}`);

        // NEW: Hide last guesser display by default for all phases, it will be shown only in 'playing' if applicable
        if (lastGuesserDisplay) {
            lastGuesserDisplay.classList.add('hidden');
        }
        
        // This is where the old admin auto-join logic was. It has been removed.
        // The client's role is now determined by the initial join and the 'roomState' is used for UI synchronization.
        const isCurrentClientAdmin = (gameState.roomAdminId === userUUID);

        // Update player list
        playerListDiv.innerHTML = '';
        if (gameState.players) {
            gameState.players.forEach(p => {
                const playerElement = tpPlayerChip(p.name, { offline: p.online === false, tag: 'div', me: p.uuid === userUUID, className: 'player-card' });
                playerListDiv.appendChild(playerElement);
            });
        }

        // Update screens based on game phase
        switch (gameState.phase) {
            case 'waiting':
                showScreen('waiting');
                countdownTimer.textContent = 'Esperando a que el anfitrión empiece la partida';
                countdownTimer.classList.remove('is-counting');
                voyButton.disabled = false;
                voyButton.classList.add('hidden');
                break;
            case 'countdown':
                showScreen('waiting');
                break;
            case 'playing':
                const currentPlayer = gameState.players.find(p => p.uuid === userUUID);
                const hasAlreadyPlayed = gameState.lastPlayerOrder.includes(userUUID);
                
                console.log(`[Lamente-Client] Playing phase in roomState. CurrentPlayer: ${currentPlayer ? currentPlayer.name : 'N/A'}, Number: ${currentPlayer ? currentPlayer.number : 'N/A'}, HasPlayed: ${hasAlreadyPlayed}`);

                // NEW: Display last correct guesser
                if (gameState.lastCorrectGuess && lastGuesserDisplay) {
                    lastGuesserDisplay.innerHTML = '';
                    const lg1 = document.createElement('span'); lg1.textContent = 'Última carta';
                    const lg2 = document.createElement('strong'); lg2.className = 'num'; lg2.textContent = gameState.lastCorrectGuess.number;
                    const lg3 = document.createElement('span'); lg3.textContent = gameState.lastCorrectGuess.name;
                    lastGuesserDisplay.append(lg1, lg2, lg3);
                    lastGuesserDisplay.classList.remove('hidden');
                } else if (lastGuesserDisplay) { // This else-if is technically redundant due to the default hide, but keeps clarity
                    lastGuesserDisplay.classList.add('hidden');
                }

                if (currentPlayer && currentPlayer.number !== null) { // If player has a number assigned
                    playerNumberSpan.textContent = currentPlayer.number;
                    gameInfoDiv.innerHTML = lmInfo(gameState.settings.min, gameState.settings.max, gameState.remainingPlayers.length);

                    if (hasAlreadyPlayed) {
                        voyButton.disabled = true;
                        voyButton.classList.add('hidden');
                        console.log(`[Lamente-Client] Player ${userName} has already played, VOY button hidden.`);
                    } else {
                        voyButton.disabled = false;
                        voyButton.classList.remove('hidden');
                        console.log(`[Lamente-Client] Player ${userName} has NOT played, VOY button visible.`);
                    }
                } else { // No number yet, revert to default '?'
                    playerNumberSpan.textContent = '?';
                    voyButton.disabled = true;
                    voyButton.classList.add('hidden');
                    console.log(`[Lamente-Client] Current player (${userName}) has no number yet (from roomState), VOY button hidden.`);
                }
                showScreen('game');
                break;
            case 'finished':
                showScreen('game-over');
                break;
        }
    });

    socket.on('gameStarting', (initialCountdown) => {
        console.log(`[Lamente-Client] Received gameStarting: ${initialCountdown}`);
        showScreen('waiting');
        countdownTimer.innerHTML = `Empieza en <span class="lm-count num">${Number(initialCountdown)}</span>`;
        countdownTimer.classList.add('is-counting');
    });

    socket.on('countdownTick', (countdown) => {
        console.log(`[Lamente-Client] Received countdownTick: ${countdown}`);
        countdownTimer.innerHTML = `Empieza en <span class="lm-count num">${Number(countdown)}</span>`;
        countdownTimer.classList.add('is-counting');
    });

    socket.on('gameStarted', (data) => {
        console.log(`[Lamente-Client] Received gameStarted. Number: ${data.number}, Range: ${data.range.min}-${data.range.max}, Remaining: ${data.remainingCount}`);
        showScreen('game');
        playerNumberSpan.textContent = data.number;
        playerNumberSpan.classList.remove('is-dealt'); void playerNumberSpan.offsetWidth; playerNumberSpan.classList.add('is-dealt');
        gameInfoDiv.innerHTML = lmInfo(data.range.min, data.range.max, data.remainingCount);
        voyButton.disabled = false;
        voyButton.classList.remove('hidden');
        // Re-check if this player already played (for reconnects during playing phase)
        if (window.gameState && window.gameState.lastPlayerOrder.includes(userUUID)) {
            voyButton.disabled = true;
            voyButton.classList.add('hidden');
            console.log(`[Lamente-Client] After gameStarted, player ${userName} has already played (from gameState), VOY button hidden.`);
        }
    });

    voyButton.addEventListener('click', () => {
        console.log(`[Lamente-Client] VOY button clicked by ${userName} (${userUUID}).`);
        voyButton.disabled = true;
        voyButton.classList.add('hidden');
        socket.emit('lamente:pressVoy', { roomId, userId: userUUID });
    });

    socket.on('playerGuessedCorrectly', (data) => {
        // (clon) el servidor manda remainingCount; antes se leía remainingPlayers.length y petaba
        const remaining = data.remainingCount != null ? data.remainingCount : (data.remainingPlayers || []).length;
        if (window.gameState && window.gameState.settings) gameInfoDiv.innerHTML = lmInfo(window.gameState.settings.min, window.gameState.settings.max, remaining);
        if (data.playerName === userName) { // Or check against userUUID for more robustness
            voyButton.disabled = true;
            voyButton.classList.add('hidden');
            console.log(`[Lamente-Client] Player ${userName} guessed correctly, VOY button hidden.`);
        }
    });

        socket.on('gameOver', (data) => {

            try {

                // Stricter defensive check to prevent crash if data is malformed

                if (!data || !Array.isArray(data.results)) {

                    console.error('[Lamente-Client] Received malformed or incomplete gameOver event inside TRY block:', data);

                    gameOverTitle.textContent = '¡Fin del juego!';

                    gameOverReason.textContent = 'Ocurrió un error al mostrar los resultados.';

                    showScreen('game-over');

                    return;

                }

    

                const resultsString = data.results.map(p => (p ? `${p.name}:${p.number}` : 'invalid player data')).join(', ');

                console.log(`[Lamente-Client] Received gameOver. Win: ${data.win}, FailingPlayer: ${data.failingPlayerUUID}, Results: ${resultsString}`);

                

                showScreen('game-over');

    

                if (data.win) {

                    gameOverTitle.textContent = '¡Habéis ganado!';
                    gameOverScreen.classList.add('is-win'); gameOverScreen.classList.remove('is-lose');

                    gameOverReason.textContent = 'Todos los jugadores han acertado el orden.';

                } else {

                    const failingPlayer = data.results.find(p => p && p.uuid === data.failingPlayerUUID);

                    gameOverTitle.textContent = '¡Habéis perdido!';
                    gameOverScreen.classList.add('is-lose'); gameOverScreen.classList.remove('is-win');

                    gameOverReason.textContent = `La secuencia se ha roto por culpa de ${failingPlayer ? failingPlayer.name : 'un jugador desconocido'}.`;

                }

    

                resultsList.innerHTML = '';

                data.results.forEach(player => {

                    if (!player) return; // Add safety check for each player

                    const playerElement = document.createElement('div');

                    playerElement.className = 'player-card result-card';
                    playerElement.style.setProperty('--i', resultsList.children.length);
                    const rn = document.createElement('span'); rn.className = 'result-num num'; rn.textContent = player.number;
                    const rnm = document.createElement('span'); rnm.className = 'result-name'; rnm.textContent = player.name;
                    playerElement.append(rn, rnm);

                    if (player.uuid === data.failingPlayerUUID) {

                        playerElement.classList.add('is-fail');

                    } else if (data.correctlyGuessedPlayers && data.correctlyGuessedPlayers.includes(player.uuid)) {

                        playerElement.classList.add('correct-guess'); // Clase para resaltar en verde

                    }

                    resultsList.appendChild(playerElement);

                });

    

                const gameOverScreenDiv = document.getElementById('game-over-screen');

                const existingButton = gameOverScreenDiv.querySelector('#play-again-admin-button');

                if (existingButton) existingButton.remove();

    

                if (window.gameState && window.gameState.roomAdminId === userUUID) {

                    const playAgainButton = document.createElement('button');

                    playAgainButton.id = 'play-again-admin-button';

                    playAgainButton.innerHTML = '<i class="bi bi-arrow-repeat"></i> Jugar otra vez';

                    playAgainButton.className = 'btn-primary btn-custom lm-again';

                    playAgainButton.onclick = () => {

                        console.log(`[Lamente-Client] Admin clicking 'Play Again'. Emitting resetGame.`);

                        socket.emit('lamente:resetGame', { roomId, userId: userUUID });

                    };

                    gameOverScreenDiv.appendChild(playAgainButton);

                }

    

                nextGameCountdownEl.textContent = '';

            } catch (error) {

                console.error("!!! FATAL ERROR in gameOver handler !!!");

                console.error("Error:", error);

                console.error("Data received that caused the error:", data);

            }

        });

    socket.on('gameReset', () => {
        console.log(`[Lamente-Client] Received gameReset.`);
        if (window.gameState && window.gameState.roomAdminId === userUUID) {
            // This is the admin. Save their name and redirect to the admin panel for this room.
            console.log(`[Lamente-Client] User is admin. Redirecting to admin panel for room ${roomId}.`);
            const adminPlayer = window.gameState.players.find(p => p.uuid === userUUID);
            if (adminPlayer) {
                localStorage.setItem('laMenteAdminName', adminPlayer.name);
            }
            window.location.href = `/admin/lamente/${roomId}`;
            } else {
                // This is a regular player. Set a flag and reload so they can auto-rejoin.
                console.log(`[Lamente-Client] User is a player. Setting play-again flag and reloading.`);
                sessionStorage.setItem('isPlayAgain', 'true');
                window.location.reload();
            }    });});