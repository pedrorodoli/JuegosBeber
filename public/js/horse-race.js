document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- UUID de Usuario ---
    let userUUID = localStorage.getItem('userUUID');
    if (!userUUID) {
        userUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('userUUID', userUUID);
    }

    // --- Elementos del DOM y Placeholders ---
    const views = {
        countdown: document.getElementById('countdown-view'),
        race: document.getElementById('race-view'),
        results: document.getElementById('results-view')
    };
    const joinForm = document.getElementById('join-race-form');
    const adminControls = document.getElementById('admin-controls');
    const startRaceBtn = document.getElementById('start-race-btn');
    const horsePlaceholders = { Oros: '[O]', Copas: '[C]', Espadas: '[E]', Bastos: '[B]' };

    // --- Función para cambiar de vista ---
    const showView = (viewName) => {
        Object.values(views).forEach(view => view.style.display = 'none');
        if (views[viewName]) {
            views[viewName].style.display = 'flex';
        }
    };

    // --- Lógica de Conexión y Sala ---
    socket.on('connect', () => {
        console.log('Conectado al servidor. Uniendo a la sala...');
        const storedPassword = sessionStorage.getItem(`roomPassword_${ROOM_ID}`); // Retrieve stored password from sessionStorage
        socket.emit('joinRoom', { gameType: GAME_TYPE, roomId: ROOM_ID, user: { uuid: userUUID, password: storedPassword } });
    });

    socket.on('error', async ({ message }) => {
        if (message === 'Contraseña incorrecta.') {
            // Only prompt if a password was actually sent and was incorrect, or if no password was sent
            const lastAttemptedPassword = sessionStorage.getItem(`roomPassword_${ROOM_ID}`);
            if (lastAttemptedPassword !== null) { // A password was sent, and it was wrong
                alert('Contraseña incorrecta. Por favor, inténtalo de nuevo.');
            }
            const password = prompt('Esta sala está protegida con contraseña. Por favor, introdúcela:');
            if (password === null) { // User cancelled
                sessionStorage.removeItem(`roomPassword_${ROOM_ID}`); // Clear any stored password
                window.location.href = '/';
                return;
            }
            sessionStorage.setItem(`roomPassword_${ROOM_ID}`, password); // Store new password in sessionStorage
            // Re-emit joinRoom with new password
            socket.emit('joinRoom', { gameType: GAME_TYPE, roomId: ROOM_ID, user: { uuid: userUUID, password } });
        } else {
            alert(`Error: ${message}`);
            window.location.href = '/';
        }
    });

    // --- Lógica de Eventos del Cliente ---
    joinForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const playerName = document.getElementById('playerName').value;
        const horse = document.getElementById('horseSelection').value;
        const bet = document.getElementById('betAmount').value;

        if (!playerName || !horse || !bet) {
            return alert('Por favor, completa todos los campos.');
        }

        socket.emit('placeBet', { roomId: ROOM_ID, player: { uuid: userUUID, name: playerName, betOn: horse, betAmount: parseInt(bet) } });

        document.getElementById('bet-form-container').style.display = 'none';
        document.getElementById('waiting-room-container').style.display = 'block';
    });

    startRaceBtn.addEventListener('click', () => {
        socket.emit('manualStart', { roomId: ROOM_ID, gameType: GAME_TYPE, userId: userUUID });
    });

    // --- Funciones de Actualización de UI ---
    function escapeHTML(str) {
        return str.toString().replace(/[&<>"'\/]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;', '/': '&#x2F;' }[s]));
    }

    const handleAdminControls = (state) => {
        const isAdmin = state.roomAdminId === userUUID;
        const canStart = state.phase === 'waiting' && state.players.length >= 2;
        if (isAdmin && canStart) {
            adminControls.style.display = 'block';
        } else {
            adminControls.style.display = 'none';
        }
    };

    const updatePlayerList = (players) => {
        const listWaiting = document.getElementById('player-list-waiting');
        const listRunning = document.getElementById('player-list-running');
        
        [listWaiting, listRunning].forEach(list => {
            if (!list) return;
            list.innerHTML = '';
            if (players && players.length > 0) {
                players.forEach(p => {
                    const li = document.createElement('li');
                    li.className = 'list-group-item';
                    const betInfo = p.betAmount ? ` - ${p.betAmount} trago(s) en ${horsePlaceholders[p.betOn]}` : '';
                    li.textContent = `${escapeHTML(p.name)}${betInfo}`;
                    list.appendChild(li);
                });
            } else {
                list.innerHTML = '<li class="list-group-item">Aún no hay jugadores.</li>';
            }
        });
    };

    const updateCountdownView = (state) => {
        document.getElementById('race-name-countdown').textContent = `Sala: ${ROOM_ID}`;
        document.getElementById('betAmount').max = state.settings.maxBet;

        const player = state.players.find(p => p.uuid === userUUID);
        const playerHasBet = player && player.betAmount;

        if (playerHasBet) {
            document.getElementById('bet-form-container').style.display = 'none';
            document.getElementById('waiting-room-container').style.display = 'block';
        } else {
            document.getElementById('bet-form-container').style.display = 'block';
            document.getElementById('waiting-room-container').style.display = 'none';
        }
    };

    const updateRaceView = (state) => {
        document.getElementById('race-name-running').textContent = `¡La carrera ha comenzado!`;
        const { positions, lastCard, stepCards } = state.raceData;
        const { levels } = state.settings;

        // Actualizar posición de los caballos
        for (const suit in positions) {
            const horseEl = document.getElementById(`horse-${suit}`);
            if (horseEl) {
                const percentage = (positions[suit] / levels) * 100;
                horseEl.style.bottom = `${Math.min(100, percentage)}%`;
            }
        }

        // Actualizar la última carta sacada
        const lastCardEl = document.getElementById('last-card-drawn');
        if (lastCardEl) {
            if (lastCard) {
                lastCardEl.innerHTML = `
                <div class="card-display">
                    <div class="card-center" style="background-image: url('/images/cartas/${lastCard.number}_${lastCard.suit.toUpperCase()}.png');"></div>
                </div>`;
            } else {
                lastCardEl.innerHTML = ''; // Limpiar si no hay carta
            }
        }

        // Renderizar las cartas de los escalones
        const stepCardsContainer = document.getElementById('step-cards-container');
        if (stepCardsContainer && stepCards) {
            stepCardsContainer.innerHTML = ''; // Limpiar antes de redibujar

            stepCards.forEach((stepCardData) => {
                const cardWrapper = document.createElement('div');
                cardWrapper.className = `step-card ${stepCardData.revealed ? 'revealed' : ''}`;

                const card = stepCardData.card;
                const cardHTML = `
                    <div class="step-card-inner">
                        <div class="step-card-face step-card-front"></div>
                        <div class="step-card-face step-card-back" style="background-image: url('/images/cartas/${card.number}_${card.suit.toUpperCase()}.png');"></div>
                    </div>
                `;
                cardWrapper.innerHTML = cardHTML;
                stepCardsContainer.appendChild(cardWrapper);
            });
        }
    };

    function updateDistributionView(state) {
        document.getElementById('race-name-finished').textContent = 'Reparto de Tragos';
        const resultsBody = document.getElementById('results-body');
        const { players, winners, winnersDistributedDrinks } = state;
        const meAsWinner = winners.find(w => w.uuid === userUUID);

        let html = '';

        if (meAsWinner) {
            if (winnersDistributedDrinks.includes(userUUID)) {
                html = '<h3>Ya has repartido tus tragos.</h3><p>Esperando a que los demás ganadores terminen...</p>';
            } else {
                const sipsToDistribute = meAsWinner.sipsWon;
                const otherPlayers = players.filter(p => p.uuid !== userUUID);

                html = `
                    <h3>¡Has ganado ${sipsToDistribute} tragos!</h3>
                    <p>Reparte tus tragos entre los demás jugadores.</p>
                    <div id="distribution-form">
                        <p>Tragos restantes: <span id="sips-remaining">${sipsToDistribute}</span></p>
                        <ul class="list-group">
                `;

                otherPlayers.forEach(p => {
                    html += `
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            ${escapeHTML(p.name)}
                            <input type="number" class="form-control form-control-sm" data-player-uuid="${p.uuid}" min="0" value="0" style="width: 80px;">
                        </li>
                    `;
                });

                html += `
                        </ul>
                        <button id="distribute-btn" class="btn btn-success mt-3">Repartir</button>
                    </div>
                `;
            }
        } else {
            html = '<h3>La carrera ha terminado.</h3><p>Esperando a que los ganadores repartan los tragos...</p>';
        }

        resultsBody.innerHTML = html;

        if (meAsWinner && !winnersDistributedDrinks.includes(userUUID)) {
            const distributeBtn = document.getElementById('distribute-btn');
            const sipsRemainingEl = document.getElementById('sips-remaining');
            const inputs = document.querySelectorAll('#distribution-form input');
            const sipsWon = meAsWinner.sipsWon;

            function updateTotal() {
                let totalDistributed = 0;
                inputs.forEach(input => {
                    totalDistributed += parseInt(input.value) || 0;
                });
                const remaining = sipsWon - totalDistributed;
                sipsRemainingEl.textContent = remaining;
                distributeBtn.disabled = remaining !== 0;
                 if (remaining < 0) {
                    sipsRemainingEl.classList.add('text-danger');
                } else {
                    sipsRemainingEl.classList.remove('text-danger');
                }
            }

            inputs.forEach(input => input.addEventListener('input', updateTotal));

            distributeBtn.addEventListener('click', () => {
                const distribution = {};
                let totalDistributed = 0;
                inputs.forEach(input => {
                    const amount = parseInt(input.value) || 0;
                    if (amount > 0) {
                        distribution[input.dataset.playerUuid] = amount;
                    }
                    totalDistributed += amount;
                });

                if (totalDistributed !== sipsWon) {
                    alert(`Debes repartir exactamente ${sipsWon} tragos.`);
                    return;
                }

                socket.emit('horse_race:distribute_drinks', {
                    roomId: ROOM_ID,
                    winnerUuid: userUUID,
                    distribution
                });
            });
             updateTotal();
        }
    }

    const updateResultsView = (state) => {
        document.getElementById('race-name-finished').textContent = 'Resultados';
        const resultsBody = document.getElementById('results-body');
        const { winner, roomAdminId, sipDistributionLog, noWinnerBets } = state;
        const isAdmin = roomAdminId === userUUID;

        let html = `<h1>Carrera finalizada</h1>`;
        if (noWinnerBets) {
            html += `<p>Nadie apostó por el caballo ganador (<strong>${winner}</strong>), o no hubo ganador. ¡Nadie bebe!</p>`;
        } else if (winner) {
            html += `<p>El caballo ganador fue <strong>${winner}</strong>.</p>`;

            const winningPlayers = state.players.filter(p => p.betOn === winner);
            if (winningPlayers.length > 0) {
                html += '<h5>Ganadores:</h5>';
                html += '<ul class="list-group">';
                winningPlayers.forEach(p => {
                    html += `<li class="list-group-item">${escapeHTML(p.name)}</li>`;
                });
                html += '</ul>';
            }
        } else {
            html += `<p>¡Hubo un empate! Nadie bebe (esta vez).</p>`;
        }

        // Display received sips
        if (sipDistributionLog && sipDistributionLog.length > 0) {
            const mySips = sipDistributionLog.filter(log => log.to_uuid === userUUID);
            
            if (mySips.length > 0) {
                html += `<div class="sips-received-summary card mt-4">`;
                html += `<div class="card-body">`;
                html += `<h4 class="card-title">Tragos Recibidos</h4>`;
                
                const sipsBySender = mySips.reduce((acc, log) => {
                    acc[log.from_name] = (acc[log.from_name] || 0) + log.amount;
                    return acc;
                }, {});

                html += `<ul class="list-group list-group-flush">`;
                for (const from_name in sipsBySender) {
                    const amount = sipsBySender[from_name];
                    html += `<li class="list-group-item">${escapeHTML(from_name)} te ha mandado ${amount} trago(s).</li>`;
                }
                html += `</ul>`;
                html += `</div></div>`;
            }
        }

        if (isAdmin) {
            html += `<button id="play-again-btn" class="btn btn-primary mt-4">Jugar de nuevo</button>`;
        }

        resultsBody.innerHTML = html;

        if (isAdmin) {
            document.getElementById('play-again-btn').addEventListener('click', () => {
                socket.emit('resetGame', { roomId: ROOM_ID, gameType: GAME_TYPE, userId: userUUID });
            });
        }
    };

    socket.on('roomState', (state) => {
        console.log('Estado de la sala actualizado:', state);
        updatePlayerList(state.players);
        handleAdminControls(state);

        switch (state.phase) {
            case 'waiting':
                showView('countdown');
                updateCountdownView(state);
                break;
            case 'race':
                showView('race');
                updateRaceView(state);
                break;
            case 'distributing':
                showView('results');
                updateDistributionView(state);
                break;
            case 'finished':
                showView('results');
                updateResultsView(state);
                break;
        }
    });

    // --- Listen for drinks received ---
    socket.on('horse_race:drinks_received', ({ from, amount }) => {
        Toastify({
            text: `¡Recibes ${amount} trago(s) de ${from}! 🍻`,
            duration: 5000,
            close: true,
            gravity: "top", // `top` or `bottom`
            position: "right", // `left`, `center` or `right`
            backgroundColor: "linear-gradient(to right, #00b09b, #96c93d)",
            stopOnFocus: true, // Prevents dismissing of toast on hover
        }).showToast();
    });

    // Estado inicial
    showView('countdown');
});
