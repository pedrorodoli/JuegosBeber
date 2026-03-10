const socket = io();

// User setup
let userUuid = localStorage.getItem('userUuid');
let storedName = localStorage.getItem('userName');

if (!userUuid) {
    userUuid = 'xxxx-xxxx-xxxx-xxxx'.replace(/[x]/g, () => (Math.random()*16|0).toString(16));
    localStorage.setItem('userUuid', userUuid);
}

// Always prompt for name, defaulting to stored one
let userName = prompt("Ingresa tu nombre:", storedName || "");
if (!userName || userName.trim() === "") {
    userName = storedName || `Jugador ${Math.floor(Math.random() * 1000)}`;
}
localStorage.setItem('userName', userName);


const password = sessionStorage.getItem(`roomPassword_${roomId}`);

// Join Room
socket.emit('joinRoom', { 
    gameType: gameType, 
    roomId: roomId, 
    user: { uuid: userUuid, name: userName, password: password } 
});

const gameArea = document.getElementById('game-area');
const adminControls = document.getElementById('admin-controls');
const btnStart = document.getElementById('btn-start');

let currentGameState = null;

// --- Socket Events ---

socket.on('roomState', (gameState) => {
    console.log('Room State Update:', gameState);
    currentGameState = gameState;
    renderGame(gameState);
});

socket.on('error', (err) => {
    alert(err.message);
    window.location.href = '/';
});

// --- UI Rendering ---

function renderGame(gameState) {
    // Show admin controls if current user is creator
    if (gameState.roomAdminId === userUuid) {
        adminControls.style.display = 'block';
    } else {
        adminControls.style.display = 'none';
    }

    if (gameState.phase === 'waiting') {
        renderWaiting(gameState);
    } else if (gameState.phase === 'playing') {
        renderPlaying(gameState);
    } else if (gameState.phase === 'finished') {
        renderFinished(gameState); 
    }
}

function renderWaiting(gameState) {
    const playerCount = gameState.players.length;
    let html = `
        <h1 class="mb-4">Sala de Espera</h1>
        <p class="lead">Esperando a que el administrador inicie la partida...</p>
        <div class="mt-4">
            <h3>Jugadores conectados (${playerCount}):</h3>
            <ul class="list-group list-group-flush bg-transparent">
    `;

    gameState.players.forEach(p => {
        html += `<li class="list-group-item bg-transparent text-white border-bottom border-secondary">
                    ${p.name} ${p.uuid === userUuid ? '(Tú)' : ''}
                 </li>`;
    });

    html += `</ul></div>`;
    
    if (gameState.roomAdminId === userUuid) {
        if (playerCount < 2) {
            html += `<div class="alert alert-warning mt-3">Se necesitan al menos 2 jugadores para empezar.</div>`;
        }
    }

    gameArea.innerHTML = html;
    
    // Disable start button if not enough players logic moved to click handler for better UX (toast)
    // But we can also visually disable it here if we wanted to be strict. 
    // The previous code disabled it. Let's keep it enabled to show the toast.
    if (btnStart) btnStart.disabled = false; 
}

function renderPlaying(gameState) {
    const assignments = gameState.assignments || {};
    const myTargetUuid = assignments[userUuid];
    
    // Find target name
    const targetPlayer = gameState.players.find(p => p.uuid === myTargetUuid);
    const targetName = targetPlayer ? targetPlayer.name : "???";

    let html = `
        <h1>¡Juego en Curso!</h1>
        <div class="target-card">
            <p class="instruction">Debes imitar a:</p>
            <div class="target-name">${targetName}</div>
        </div>
    `;

    gameArea.innerHTML = html;
}

function renderFinished(gameState) {
    renderPlaying(gameState); 
}

// --- Admin Actions ---

if (btnStart) {
    btnStart.addEventListener('click', () => {
        // Use currentGameState for accurate player count
        if (!currentGameState || !currentGameState.players || currentGameState.players.length < 2) {
            Toastify({
                text: "No puedes repartir porque estás solo :(",
                duration: 3000,
                gravity: "top",
                position: "center",
                style: {
                    background: "linear-gradient(to right, #ff5f6d, #ffc371)",
                }
            }).showToast();
            return;
        }
        socket.emit('imitador:startGame', { roomId, userId: userUuid });
    });
}
