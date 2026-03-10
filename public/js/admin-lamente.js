document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const createRoomScreen = document.getElementById('create-room-screen');
    const adminPanelScreen = document.getElementById('admin-panel-screen');
    const createRoomForm = document.getElementById('create-room-form');
    const adminNameInput = document.getElementById('admin-name');

    let adminUUID = localStorage.getItem('userUUID');
    if (!adminUUID) {
        adminUUID = crypto.randomUUID();
        localStorage.setItem('userUUID', adminUUID);
        console.log(`[Admin-Lamente-Client] Generated new userUUID: ${adminUUID}`);
    }

    // Pre-fill admin name if it exists in localStorage
    const savedAdminName = localStorage.getItem('laMenteAdminName');
    if (savedAdminName) {
        adminNameInput.value = savedAdminName;
    }
    
    // Check if a roomId is in the URL path, which happens when an admin "plays again".
    const pathParts = window.location.pathname.split('/');
    const roomIdFromUrl = pathParts.length === 4 && pathParts[1] === 'admin' && pathParts[2] === 'lamente' ? pathParts[3] : null;

    if (roomIdFromUrl) {
        // A room ID exists in the URL, so we are managing an existing room.
        // The admin's name should be in localStorage from the previous game session.
        const adminName = localStorage.getItem('laMenteAdminName') || localStorage.getItem('userName') || 'Admin';
        // We don't have the specific room name here, so we could fetch it or use a generic one.
        // For now, we'll just render the panel. The roomState event will provide the real name.
        console.log(`[Admin-Lamente-Client] Re-entering admin panel for room ${roomIdFromUrl}.`);
        renderAdminPanel(roomIdFromUrl, "Sala de La Mente", adminName);
    } else {
        // No room ID in URL, show the creation form as normal.
        createRoomScreen.classList.remove('hidden');
        adminPanelScreen.classList.add('hidden');
    }

    createRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const roomName = document.getElementById('room-name').value.trim();
        const roomPassword = document.getElementById('room-password').value.trim();
        const adminName = adminNameInput.value.trim();

        if (!roomName || !adminName) {
            alert('Por favor, introduce tu nombre de jugador y un nombre para la sala.');
            return;
        }

        // Save the admin's name for future sessions under the general 'userName' key
        localStorage.setItem('userName', adminName);

        try {
            const response = await fetch('/api/rooms/lamente', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: roomName,
                    password: roomPassword || null,
                    creatorId: adminUUID,
                    settings: { min: 1, max: 100 } // Default settings without countdown
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Error al crear la sala');
            }

            const { roomId } = data;
            // Update URL to reflect the new room ID without reloading
            history.pushState({ roomId }, `Admin - ${roomName}`, `/admin/lamente/${roomId}`);
            renderAdminPanel(roomId, roomName, adminName);

        } catch (error) {
            console.error('Error creating room:', error);
            alert(`Error: ${error.message}`);
        }
    });

    function renderAdminPanel(roomId, roomName, adminName) {
        createRoomScreen.classList.add('hidden');
        adminPanelScreen.classList.remove('hidden');

        const adminRoomName = document.getElementById('admin-room-name');
        adminRoomName.textContent = `Admin: ${roomName}`;

        const minRangeInput = document.getElementById('min-range');
        const maxRangeInput = document.getElementById('max-range');
        const startGameButton = document.getElementById('start-game-button');
        const adminPlayerList = document.getElementById('admin-player-list');

        // Load initial settings from localStorage if available
        const settingsKey = `lamenteAdminSettings_${roomId}`;
        if (localStorage.getItem(settingsKey)) {
            const savedSettings = JSON.parse(localStorage.getItem(settingsKey));
            minRangeInput.value = savedSettings.min;
            maxRangeInput.value = savedSettings.max;
        }
        
        // Join the room as an admin/player to receive updates
        socket.emit('joinRoom', { gameType: 'lamente', roomId, user: { uuid: adminUUID, name: adminName } });

        startGameButton.addEventListener('click', () => {
            const config = {
                min: minRangeInput.value,
                max: maxRangeInput.value,
                // Countdown is no longer sent from the client
            };
            // Save settings to localStorage
            localStorage.setItem(settingsKey, JSON.stringify(config));
            
            socket.emit('lamente:startGame', { roomId, userId: adminUUID, settings: config });
        });

        // Listen for countdown to redirect
        socket.on('countdownTick', (countdownValue) => {
            startGameButton.disabled = true;
            startGameButton.textContent = `La partida comienza en ${countdownValue}...`;
            if(countdownValue <= 0) {
                 // The server will emit gameStarted, but we can redirect preemptively
                 sessionStorage.setItem('isAdminNavigatingToGame', 'true'); // NEW: Set flag
                 setTimeout(() => {
                    window.location.href = `/game/lamente/${roomId}`;
                 }, 500); // Small delay to allow server to process
            }
        });

        socket.on('roomState', (gameState) => {
            if (!gameState) return;
            
            // Update player list
            adminPlayerList.innerHTML = '';
            if (gameState.players) {
                gameState.players.forEach(p => {
                    const playerElement = document.createElement('div');
                    playerElement.className = 'player-card';
                    playerElement.textContent = p.name;
                    adminPlayerList.appendChild(playerElement);
                });
            }

            // Update button states based on game phase
            if (gameState.phase === 'playing' || gameState.phase === 'countdown') {
                startGameButton.disabled = true;
                startGameButton.textContent = 'Partida en curso...';
            } else {
                startGameButton.disabled = false;
                startGameButton.textContent = 'Iniciar Partida';
            }

            // Update settings inputs if the state is fresh
            if (gameState.settings) {
                minRangeInput.value = gameState.settings.min;
                maxRangeInput.value = gameState.settings.max;
            }
        });

        socket.on('error', (data) => {
            console.error('Server error:', data.message);
            alert(`Error: ${data.message}`);
        });
    }
});
