document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Vistas
    const loginScreen = document.getElementById('login-screen');
    const waitingScreen = document.getElementById('waiting-screen');
    const gameScreen = document.getElementById('game-screen');
    const gameOverScreen = document.getElementById('game-over-screen');

    // Elementos del DOM
    const nameInput = document.getElementById('name-input');
    const joinButton = document.getElementById('join-button');
    const playerList = document.getElementById('player-list');
    
    let playerUUID = localStorage.getItem('playerUUID');

    // --- Lógica de Conexión ---

    if (playerUUID) {
        console.log('Reconectando con UUID:', playerUUID);
        socket.emit('reconnect', playerUUID);
        showScreen('waiting'); // Asumir que la reconexión tendrá éxito y mostrar 'waiting'
    } else {
        showScreen('login');
    }

    joinButton.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (name) {
            socket.emit('join', name);
        }
    });

    socket.on('playerRegistered', (uuid) => {
        console.log('Registrado con UUID:', uuid);
        playerUUID = uuid;
        localStorage.setItem('playerUUID', uuid);
        showScreen('waiting');
    });

    socket.on('reconnectFailed', () => {
        console.log('Reconexión fallida, pidiendo nuevo registro.');
        localStorage.removeItem('playerUUID');
        playerUUID = null;
        showScreen('login');
    });

    socket.on('reconnectSuccess', () => {
        console.log('Reconexión exitosa.');
        showScreen('waiting');
    });

    // --- Actualizaciones de Estado ---

    socket.on('playerList', (players) => {
        playerList.innerHTML = '';
        players.forEach(name => {
            const playerElement = document.createElement('div');
            playerElement.className = 'player-card';
            playerElement.textContent = name;
            playerList.appendChild(playerElement);
        });
    });
    const countdownTimer = document.getElementById('countdown-timer');
    const playerNumber = document.getElementById('player-number');
    const gameInfo = document.getElementById('game-info');
    const voyButton = document.getElementById('voy-button');
    let nextGameCountdownInterval; // Para limpiar el intervalo anterior
    
    // Inicializar el texto de la cuenta atrás de la sala de espera vacío
    countdownTimer.textContent = ''; 

    // --- Lógica de Juego ---
    
    socket.on('gameStarting', (initialCountdown) => {
        showScreen('waiting');
        if (nextGameCountdownInterval) {
            clearInterval(nextGameCountdownInterval); // Limpiar cualquier intervalo anterior
        }
        countdownTimer.textContent = `La partida comienza en ${initialCountdown} segundos...`;
    });

    socket.on('countdownTick', (countdown) => {
        countdownTimer.textContent = `La partida comienza en ${countdown} segundos...`;
    });

    socket.on('gameStarted', (data) => {
        showScreen('game');
        playerNumber.textContent = data.number;
        gameInfo.innerHTML = `Rango: ${data.range.min}-${data.range.max}<br>Faltan: ${data.remainingCount} jugadores`;
        voyButton.disabled = false;
        voyButton.classList.remove('hidden');
    });

    const gameOverTitle = document.getElementById('game-over-title');
    const gameOverReason = document.getElementById('game-over-reason');
    const resultsList = document.getElementById('results-list');
    const nextGameCountdownEl = document.getElementById('next-game-countdown');

    voyButton.addEventListener('click', () => {
        voyButton.disabled = true;
        voyButton.classList.add('hidden');
        socket.emit('pressVoy');
    });

    socket.on('playerGuessedCorrectly', (data) => {
        // Asumiendo que `gameState` se actualiza desde el servidor o es manejado de otra forma
        // temporalmente actualizamos el texto aquí hasta la próxima actualización completa del estado
        const currentRangeMin = data.range ? data.range.min : (window.gameState ? window.gameState.range.min : 1);
        const currentRangeMax = data.range ? data.range.max : (window.gameState ? window.gameState.range.max : 100);

        gameInfo.innerHTML = `Rango: ${currentRangeMin}-${currentRangeMax}<br>Faltan: ${data.remainingCount} jugadores`;
        // Opcional: mostrar una pequeña notificación de que alguien ha acertado.
    });

    socket.on('gameOver', (data) => {
        showScreen('game-over');
        if (nextGameCountdownInterval) {
            clearInterval(nextGameCountdownInterval); // Limpiar cualquier intervalo anterior
        }
        if (data.win) {
            gameOverTitle.textContent = '¡Habéis ganado!';
            gameOverReason.textContent = 'Todos los jugadores han acertado el orden.';
        } else {
            const failingPlayer = data.results.find(p => p.uuid === data.failingPlayerUUID);
            gameOverTitle.textContent = '¡Habéis perdido!';
            gameOverReason.textContent = `La secuencia se ha roto por culpa de ${failingPlayer ? failingPlayer.name : 'un jugador desconocido'}.`;
        }

        resultsList.innerHTML = '';
        data.results.forEach(player => {
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

        // La cuenta atrás solo se mostrará si el admin la inicia de nuevo
        nextGameCountdownEl.textContent = '';
        //nextGameCountdownEl.classList.remove('hidden'); // Asegurarse de que esté visible

        // No hay setInterval aquí, el admin la iniciará
    });

    socket.on('gameReset', () => {
        localStorage.removeItem('playerUUID');
        window.location.reload();
    });

    // También es necesario actualizar el gameInfo cuando el estado del juego cambia
    socket.on('gameState', (state) => {
        window.gameState = state; // Guardar estado globalmente para referencia
        if (state.status === 'waiting') {
            nextGameCountdownEl.textContent = ''; // Asegurarse de que esté vacío si se vuelve a waiting
        }
    });

    // --- Helpers ---
    function showScreen(screenName) {
        loginScreen.classList.add('hidden');
        waitingScreen.classList.add('hidden');
        gameScreen.classList.add('hidden');
        gameOverScreen.classList.add('hidden');

        document.getElementById(`${screenName}-screen`).classList.remove('hidden');
    }
});