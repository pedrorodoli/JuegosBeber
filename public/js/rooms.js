// public/js/rooms.js

const socket = io(); // Assuming socket.io is already loaded globally

function handleJoinRoom(roomId, hasPassword) {
    let password = null;
    if (hasPassword) {
        password = prompt("Esta sala requiere una contraseña:");
        if (password === null) { // User cancelled the prompt
            return;
        }
        sessionStorage.setItem(`roomPassword_${roomId}`, password); // Store password in sessionStorage
    }

    // For now, we'll use a dummy user object. In a real app, this would come from authentication.
    // The server expects a 'user' object with 'uuid' and 'name'.
    // We'll also add the password to the user object for the server to check.
    const user = {
        uuid: localStorage.getItem('userUuid') || generateUserUuid(), // Get or generate a UUID for the user
        name: localStorage.getItem('userName') || 'Anónimo', // Get or set a default name
        password: password // Include the password for the server to validate
    };
    localStorage.setItem('userUuid', user.uuid);
    localStorage.setItem('userName', user.name);

    socket.emit('joinRoom', { gameType: gameType, roomId: roomId, user: user });
}

socket.on('roomState', (gameState) => {
    // When a user successfully joins, the server will emit 'roomState'
    // Redirect to the game page
    window.location.href = `/game/${gameType}/${gameState.id}`;
});

socket.on('error', (data) => {
    alert(`Error: ${data.message}`);
});

socket.on('roomListUpdate', async () => {
    console.log('Recibido roomListUpdate. Actualizando lista de salas...');
    try {
        const response = await fetch(`/rooms/${gameType}/data`);
        if (response.ok) {
            const data = await response.json();
            const roomListContainer = document.getElementById('room-list-container');
            if (roomListContainer) {
                let roomsHtml = '';
                if (data.rooms.length > 0) {
                    data.rooms.forEach(room => {
                        roomsHtml += `
                            <li class="list-group-item">
                                <span>
                                    ${room.name} (${room.playerCount} jugadores)
                                    ${room.hasPassword ? '<i class="bi bi-lock-fill ms-2"></i>' : ''}
                                </span>
                                <button class="btn btn-join" onclick="handleJoinRoom('${room.id}', ${room.hasPassword})">Unirse</button>
                            </li>
                        `;
                    });
                } else {
                    roomsHtml = '<p>No hay salas disponibles. ¡Crea una!</p>';
                }
                roomListContainer.innerHTML = roomsHtml;
            }
        }
    } catch (error) {
        console.error('Error al actualizar la lista de salas:', error);
    }
});

function generateUserUuid() {
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
    return uuid;
}

// This part handles the creator not being prompted for a password.
// It assumes that after creating a room, the server redirects the creator
// to the /game/:gameType/:roomId page directly, or the client-side
// logic for room creation will handle the automatic join.
// For now, we'll assume the server redirects the creator directly to the game page
// after successful room creation, bypassing the need to join via the room list.
// If the creator *does* end up on the room list page, they would still be prompted.
// A more robust solution would involve passing a 'justCreated' flag or similar
// from the server to the client after room creation.
