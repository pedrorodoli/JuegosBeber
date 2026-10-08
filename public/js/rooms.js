// public/js/rooms.js

const socket = io();

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function handleJoinRoom(roomId, hasPassword) {
    // (clon) La contraseña se comprueba ANTES de entrar, y si está mal se dice en el momento
    if (hasPassword) {
        const uuid = localStorage.getItem('userUUID') || generateUserUuid();
        localStorage.setItem('userUUID', uuid);
        let error = '';
        for (;;) {
            const password = await tpAsk({
                title: 'Sala con contraseña',
                text: 'Pídesela a quien creó la sala.',
                type: 'password',
                placeholder: 'Contraseña',
                submitLabel: 'Entrar',
                error
            });
            if (password === null) return; // Cancelado
            let res;
            try {
                res = await (await fetch(`/api/rooms/${encodeURIComponent(roomId)}/access`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password, uuid })
                })).json();
            } catch (e) { error = 'No se ha podido comprobar. Revisa la conexión.'; continue; }
            if (!res.exists) { alert('Esa sala ya no existe.'); location.reload(); return; }
            if (res.ok) { sessionStorage.setItem(`roomPassword_${roomId}`, password); break; }
            error = 'Contraseña incorrecta. Prueba otra vez.';
        }
    }
    window.location.href = `/game/${gameType}/${roomId}`;
}

socket.on('roomState', (gameState) => {
    // Al unirse correctamente, el servidor emite 'roomState': vamos a la partida
    window.location.href = `/game/${gameType}/${gameState.id}`;
});

socket.on('error', (data) => {
    alert(`Error: ${data.message}`);
});

function renderRoomRow(room, i) {
    const players = Number(room.playerCount) || 0;
    return `
        <li class="room-row" style="animation-delay:${i * 40}ms">
            <span class="room-icon" aria-hidden="true"><i class="bi ${room.hasPassword ? 'bi-lock-fill' : 'bi-door-open-fill'}"></i></span>
            <span class="room-info">
                <span class="room-name">${escapeHtml(room.name)}</span>
                <span class="room-meta"><span class="num">${players}</span> ${players === 1 ? 'jugador' : 'jugadores'}${room.hasPassword ? ' · con contraseña' : ''}</span>
            </span>
            <button class="tp-btn tp-btn--chalk tp-btn--sm btn-join" onclick="handleJoinRoom('${escapeHtml(room.id)}', ${room.hasPassword ? 'true' : 'false'})">Unirse</button>
        </li>`;
}

socket.on('roomListUpdate', async () => {
    try {
        const response = await fetch(`/rooms/${gameType}/data`);
        if (response.ok) {
            const data = await response.json();
            const roomListContainer = document.getElementById('room-list-container');
            if (roomListContainer) {
                if (data.rooms.length > 0) {
                    roomListContainer.innerHTML = data.rooms.map(renderRoomRow).join('');
                } else {
                    roomListContainer.innerHTML = `
                        <li class="rooms-empty">
                            <span class="rooms-empty-art" aria-hidden="true"><i class="bi bi-suit-spade-fill"></i></span>
                            <strong>Aún no hay salas abiertas</strong>
                            <span>Crea una y pasa el enlace al grupo. Aparecerá aquí al momento.</span>
                        </li>`;
                }
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
