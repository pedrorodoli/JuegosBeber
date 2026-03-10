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

    // --- Helper to show screens ---
    function showScreen(screenName) {
        console.log(`[Lamente-Client] Showing screen: ${screenName}`);
        // Ensure all screens are referenced correctly before trying to hide them
        if (loginScreen) loginScreen.classList.add('hidden');
        if (waitingScreen) waitingScreen.classList.add('hidden');
        if (gameScreen) gameScreen.classList.add('hidden');
        if (gameOverScreen) gameOverScreen.classList.add('hidden');

        const targetScreen = document.getElementById(`${screenName}-screen`);
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
            alert('Por favor, introduce tu nombre.');
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
                const playerElement = document.createElement('div');
                playerElement.className = 'player-card';
                playerElement.textContent = p.name;
                playerListDiv.appendChild(playerElement);
            });
        }

        // Update screens based on game phase
        switch (gameState.phase) {
            case 'waiting':
                showScreen('waiting');
                countdownTimer.textContent = 'Esperando a que el admin inicie la partida...';
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
                    lastGuesserDisplay.textContent = `Último en adivinar: ${gameState.lastCorrectGuess.name} (${gameState.lastCorrectGuess.number})`;
                    lastGuesserDisplay.classList.remove('hidden');
                } else if (lastGuesserDisplay) { // This else-if is technically redundant due to the default hide, but keeps clarity
                    lastGuesserDisplay.classList.add('hidden');
                }

                if (currentPlayer && currentPlayer.number !== null) { // If player has a number assigned
                    playerNumberSpan.textContent = currentPlayer.number;
                    gameInfoDiv.innerHTML = `Rango: ${gameState.settings.min}-${gameState.settings.max}<br>Faltan: ${gameState.remainingPlayers.length} jugadores`;

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
        countdownTimer.textContent = `La partida comienza en ${initialCountdown} segundos...`;
    });

    socket.on('countdownTick', (countdown) => {
        console.log(`[Lamente-Client] Received countdownTick: ${countdown}`);
        countdownTimer.textContent = `La partida comienza en ${countdown} segundos...`;
    });

    socket.on('gameStarted', (data) => {
        console.log(`[Lamente-Client] Received gameStarted. Number: ${data.number}, Range: ${data.range.min}-${data.range.max}, Remaining: ${data.remainingCount}`);
        showScreen('game');
        playerNumberSpan.textContent = data.number;
        gameInfoDiv.innerHTML = `Rango: ${data.range.min}-${data.range.max}<br>Faltan: ${data.remainingCount} jugadores`;
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
        console.log(`[Lamente-Client] Received playerGuessedCorrectly. Player: ${data.playerName}, Remaining: ${data.remainingPlayers.length}`);
        gameInfoDiv.innerHTML = `Rango: ${window.gameState.settings.min}-${window.gameState.settings.max}<br>Faltan: ${data.remainingPlayers.length} jugadores`;
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

                    gameOverReason.textContent = 'Todos los jugadores han acertado el orden.';

                } else {

                    const failingPlayer = data.results.find(p => p && p.uuid === data.failingPlayerUUID);

                    gameOverTitle.textContent = '¡Habéis perdido!';

                    gameOverReason.textContent = `La secuencia se ha roto por culpa de ${failingPlayer ? failingPlayer.name : 'un jugador desconocido'}.`;

                }

    

                resultsList.innerHTML = '';

                data.results.forEach(player => {

                    if (!player) return; // Add safety check for each player

                    const playerElement = document.createElement('div');

                    playerElement.className = 'player-card';

                    playerElement.textContent = `${player.name}: ${player.number}`;

                    if (player.uuid === data.failingPlayerUUID) {

                        playerElement.style.borderColor = 'red';

                        playerElement.style.backgroundColor = '#fecaca'; // Tailwind red-200

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

                    playAgainButton.textContent = 'Volver a Jugar (Admin)';

                    playAgainButton.className = 'btn-primary';

                    playAgainButton.style.marginTop = '20px';

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