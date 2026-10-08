const socket = io();

// User setup
let userUUID = localStorage.getItem('userUUID');
let storedName = localStorage.getItem('userName');

if (!userUUID) {
    userUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
    localStorage.setItem('userUUID', userUUID);
}

const gameArea = document.getElementById('game-area');
const adminControls = document.getElementById('admin-controls');
const btnStart = document.getElementById('btn-start');

// We'll show a name entry if no name is stored
const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('name-input');
const joinGameBtn = document.getElementById('join-game-btn');

function joinRoom(name) {
    const password = sessionStorage.getItem(`roomPassword_${roomId}`);
    socket.emit('joinRoom', { 
        gameType: gameType, 
        roomId: roomId, 
        user: { uuid: userUUID, name: name, password: password } 
    });
}

if (storedName) {
    joinRoom(storedName);
} else {
    if (nameModal) {
        nameModal.style.display = 'flex';
    } else {
        // Fallback if modal not added to EJS yet
        let userName = prompt("Ingresa tu nombre:");
        if (!userName || userName.trim() === "") {
            userName = `Jugador ${Math.floor(Math.random() * 1000)}`;
        }
        localStorage.setItem('userName', userName);
        joinRoom(userName);
    }
}

if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGameBtn.click(); });

if (joinGameBtn) {
    joinGameBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return alert('Escribe tu nombre para entrar.'); }
        localStorage.setItem('userName', name);
        nameModal.style.display = 'none';
        joinRoom(name);
    });
}

let currentGameState = null;
let lastTargetShown = null;

function imEsc(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
    if (gameState.roomAdminId === userUUID) {
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
    lastTargetShown = null;
    const playerCount = gameState.players.length;
    const isAdmin = gameState.roomAdminId === userUUID;
    let html = `
        <h1 class="im-title">Sala de espera</h1>
        <p class="g-sub">${isAdmin ? 'Reparte cuando estéis todos dentro.' : 'Esperando a que el anfitrión reparta.'}</p>
        <div class="im-players">
            <h3>En la sala <span class="num">${playerCount}</span></h3>
            <ul class="im-player-list" id="im-player-list"></ul>
        </div>
    `;

    if (isAdmin && playerCount < 4) {
        html += `<div class="im-note"><i class="bi bi-people"></i> Hacen falta al menos 4 jugadores para que haya misterio.</div>`;
    }

    gameArea.innerHTML = html;
    const list = document.getElementById('im-player-list');
    gameState.players.forEach(p => list.appendChild(tpPlayerChip(p.name, { offline: p.online === false, me: p.uuid === userUUID })));
    
    // Disable start button if not enough players logic moved to click handler for better UX (toast)
    // But we can also visually disable it here if we wanted to be strict. 
    // The previous code disabled it. Let's keep it enabled to show the toast.
    if (btnStart) btnStart.disabled = false; 
}

function renderPlaying(gameState) {
    const assignments = gameState.assignments || {};
    const myTargetUuid = assignments[userUUID];
    
    // Find target name
    const targetPlayer = gameState.players.find(p => p.uuid === myTargetUuid);
    const targetName = targetPlayer ? targetPlayer.name : "???";

    const isNew = lastTargetShown !== (myTargetUuid || targetName);
    lastTargetShown = myTargetUuid || targetName;
    let html = `
        <h1 class="im-title">Partida en curso</h1>
        <div class="target-card${isNew ? ' is-new' : ''}">
            <div class="target-inner">
                <div class="target-face target-back" aria-hidden="true"><i class="bi bi-incognito"></i></div>
                <div class="target-face target-front">
                    <p class="instruction">Tienes que imitar a</p>
                    <div class="target-name">${imEsc(targetName)}</div>
                </div>
            </div>
        </div>
        <p class="im-hint"><i class="bi bi-eye-slash"></i> Que nadie vea tu pantalla.</p>
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
        if (!currentGameState || !currentGameState.players || currentGameState.players.length < 4) {
            Toastify({
                text: "Hacen falta al menos 4 personas para jugar al Imitador",
                duration: 3000,
                gravity: "top",
                position: "center",
                className: 'tp-toast--drink'
            }).showToast();
            return;
        }
        socket.emit('imitador:startGame', { roomId, userId: userUUID });
    });
}
