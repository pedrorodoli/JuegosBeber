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
    const horsePlaceholders = { Oros: 'Oros', Copas: 'Copas', Espadas: 'Espadas', Bastos: 'Bastos' };
    let lastCardKey = null;

    // --- Selector visual de caballo (sincronizado con el <select>) ---
    const horseSelect = document.getElementById('horseSelection');
    const picks = document.querySelectorAll('.horse-pick');
    function selectHorse(value) {
        horseSelect.value = value;
        picks.forEach(b => {
            const on = b.dataset.horse === value;
            b.classList.toggle('is-selected', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }
    picks.forEach(b => b.addEventListener('click', () => selectHorse(b.dataset.horse)));
    selectHorse(horseSelect.value || 'Oros');

    const nameField = document.getElementById('playerName');
    if (nameField && localStorage.getItem('userName')) nameField.value = localStorage.getItem('userName');

    // --- Función para cambiar de vista ---
    // (clon) Solo cambia de vista si es otra distinta: antes se ocultaba y se volvía a mostrar
    // en cada aviso del servidor y la pantalla entera "parpadeaba".
    let currentView = null;
    const showView = (viewName) => {
        Object.entries(views).forEach(([name, view]) => tpShow(view, name === viewName ? 'flex' : 'none'));
        if (views[viewName] && currentView !== viewName) {
            views[viewName].classList.remove('is-entering'); void views[viewName].offsetWidth; views[viewName].classList.add('is-entering');
        }
        currentView = viewName;
    };

    // --- Lógica de Conexión y Sala ---
    const joinRoom = (name = null) => {
        const storedPassword = sessionStorage.getItem(`roomPassword_${ROOM_ID}`);
        const userName = name || localStorage.getItem('userName');
        socket.emit('joinRoom', { 
            gameType: GAME_TYPE, 
            roomId: ROOM_ID, 
            user: { uuid: userUUID, name: userName, password: storedPassword } 
        });
    };

    socket.on('connect', () => {
        console.log('Conectado al servidor. Uniendo a la sala...');
        const storedName = localStorage.getItem('userName');
        if (storedName) {
            joinRoom(storedName);
        }
    });

    socket.on('error', async ({ message }) => {
        if (message === 'Contraseña incorrecta.') {
            // Only prompt if a password was actually sent and was incorrect, or if no password was sent
            const lastAttemptedPassword = sessionStorage.getItem(`roomPassword_${ROOM_ID}`);
            if (lastAttemptedPassword !== null) { // A password was sent, and it was wrong
                alert('Contraseña incorrecta. Por favor, inténtalo de nuevo.');
            }
            const password = await tpAsk({ title: 'Sala con contraseña', text: 'Pídesela a quien creó la sala.', type: 'password', placeholder: 'Contraseña', submitLabel: 'Entrar' });
            if (password === null) { // User cancelled
                sessionStorage.removeItem(`roomPassword_${ROOM_ID}`); // Clear any stored password
                window.location.href = '/';
                return;
            }
            sessionStorage.setItem(`roomPassword_${ROOM_ID}`, password); // Store new password in sessionStorage
            // Re-emit joinRoom with new password
            joinRoom();
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
            return alert('Escribe tu nombre y cuántos tragos apuestas.');
        }

        localStorage.setItem('userName', playerName);
        
        // If we haven't joined yet (no stored name before), join now
        joinRoom(playerName);

        socket.emit('placeBet', { roomId: ROOM_ID, player: { uuid: userUUID, name: playerName, betOn: horse, betAmount: parseInt(bet) } });

        tpShow(document.getElementById('bet-form-container'), 'none');
        tpShow(document.getElementById('waiting-room-container'), 'block');
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
            tpShow(adminControls, 'block');
        } else {
            tpShow(adminControls, 'none');
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
                    li.className = 'hr-bet' + (p.uuid === userUUID ? ' is-me' : '');
                    li.appendChild(tpAvatar(p.name));
                    const name = document.createElement('span');
                    name.className = 'hr-bet-name';
                    name.textContent = p.name;
                    li.appendChild(name);
                    if (p.betAmount && p.betOn) {
                        const bet = document.createElement('span');
                        bet.className = 'hr-bet-on';
                        bet.innerHTML = `<img src="/images/cartas/11_${String(p.betOn).toUpperCase()}.png" alt=""><span class="num">${Number(p.betAmount)}</span>`;
                        bet.title = `${p.betAmount} trago(s) a ${horsePlaceholders[p.betOn] || p.betOn}`;
                        li.appendChild(bet);
                    } else {
                        const bet = document.createElement('span');
                        bet.className = 'hr-bet-pending';
                        bet.textContent = 'apostando…';
                        li.appendChild(bet);
                    }
                    list.appendChild(li);
                });
            } else {
                list.innerHTML = '<li class="hr-empty">Aún no hay jugadores.</li>';
            }
        });
    };

    const updateCountdownView = (state) => {
        document.getElementById('race-name-countdown').textContent = `Apuesta máxima: ${state.settings.maxBet} tragos`;
        document.getElementById('betAmount').max = state.settings.maxBet;
        lastCardKey = null;

        const player = state.players.find(p => p.uuid === userUUID);
        const playerHasBet = player && player.betAmount;

        if (playerHasBet) {
            tpShow(document.getElementById('bet-form-container'), 'none');
            tpShow(document.getElementById('waiting-room-container'), 'block');
        } else {
            tpShow(document.getElementById('bet-form-container'), 'block');
            tpShow(document.getElementById('waiting-room-container'), 'none');
        }
    };

    // (clon) Pista en 2.5D: la perspectiva se calcula aquí y todo se coloca en 2D.
    // Sin transformaciones 3D reales, así los caballos no se cortan con el suelo en móvil
    // y cada caballo se escala al ancho de su calle (no se superponen).
    const SUITS = ['Oros', 'Copas', 'Espadas', 'Bastos'];
    function raceGeom(stage, levels) {
        const w = stage.clientWidth, h = stage.clientHeight;
        const narrow = w < 520;
        const gut = narrow ? 0.18 : 0.17;               // arcén izquierdo para las cartas
        const yNear = h, kStart = narrow ? 0.62 : 0.52, kFin = narrow ? 0.93 : 0.9;
        const yStart = h * (narrow ? 0.21 : 0.25);
        const yH = (yStart - yNear * kStart) / (1 - kStart);
        const zOf = k => 1 / k - 1;
        const zS = zOf(kStart), zF = zOf(kFin);
        const half = w * 0.5 * (narrow ? 1.0 : 0.97), cx = w / 2;
        const k = z => 1 / (1 + z);
        const Y = z => yH + (yNear - yH) * k(z);
        const X = (xw, z) => cx + xw * half * k(z);
        const zAt = p => zS + (zF - zS) * (p / levels);
        const lane0 = -1 + 2 * gut, laneW = (2 - 2 * gut) / 4;
        return { w, h, k, Y, X, zAt, zS, zF, half, lane0, laneW, narrow };
    }
    function drawTrack(stage, levels) {
        const g = raceGeom(stage, levels);
        const svg = document.getElementById('race-svg');
        svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`);
        const zTop = g.zS * 1.35, zBot = 0;
        const f = n => n.toFixed(1);
        const quad = (x0, x1, z0, z1) => [[g.X(x0, z0), g.Y(z0)], [g.X(x1, z0), g.Y(z0)], [g.X(x1, z1), g.Y(z1)], [g.X(x0, z1), g.Y(z1)]].map(([x, y]) => f(x) + ',' + f(y)).join(' ');
        let out = `<defs><pattern id="hr-chk" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#10251d"/><rect width="6" height="6" fill="#eef1ea"/><rect x="6" y="6" width="6" height="6" fill="#eef1ea"/></pattern>
            <linearGradient id="hr-fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#061812" stop-opacity=".9"/><stop offset="1" stop-color="#061812" stop-opacity="0"/></linearGradient></defs>`;
        out += `<polygon points="${quad(-1, g.lane0, zBot, zTop)}" fill="#123e30"/>`;
        for (let i = 0; i < 4; i++) { const x0 = g.lane0 + i * g.laneW; out += `<polygon points="${quad(x0, x0 + g.laneW, zBot, zTop)}" fill="${i % 2 ? '#1a523f' : '#1d5a45'}"/>`; }
        for (let p = 1; p < levels; p++) { const z = g.zAt(p); out += `<line x1="${f(g.X(-1, z))}" y1="${f(g.Y(z))}" x2="${f(g.X(1, z))}" y2="${f(g.Y(z))}" stroke="rgba(238,241,234,.24)" stroke-width="${f(2 * g.k(z))}"/>`; }
        const zs = g.zAt(0); out += `<polygon points="${quad(g.lane0, 1, zs + 0.012, zs - 0.012)}" fill="rgba(238,241,234,.75)"/>`;
        const zf = g.zAt(levels); out += `<polygon points="${quad(g.lane0, 1, zf + 0.025, zf - 0.025)}" fill="url(#hr-chk)"/>`;
        for (let i = 0; i <= 4; i++) {
            const x = i === 0 ? g.lane0 : g.lane0 + i * g.laneW, edge = i === 0 || i === 4;
            out += `<line x1="${f(g.X(x, zBot))}" y1="${f(g.Y(zBot))}" x2="${f(g.X(x, zTop))}" y2="${f(g.Y(zTop))}" stroke="rgba(238,241,234,${edge ? .55 : .14})" stroke-width="${edge ? 3 : 1.5}"/>`;
        }
        out += `<line x1="${f(g.X(-1, zBot))}" y1="${f(g.Y(zBot))}" x2="${f(g.X(-1, zTop))}" y2="${f(g.Y(zTop))}" stroke="rgba(238,241,234,.35)" stroke-width="2"/>`;
        out += `<rect x="0" y="0" width="${g.w}" height="${f(g.Y(g.zS) * 0.9)}" fill="url(#hr-fog)"/>`;
        svg.innerHTML = out;
        return g;
    }
    function layoutRace() {
        const stage = document.getElementById('race-track');
        if (!stage || !stage.clientWidth || !stage.clientHeight) return;
        const levels = Number(stage.dataset.levels) || 5;
        const g = drawTrack(stage, levels);
        const laneNearPx = g.laneW * g.half;
        SUITS.forEach((suit, i) => {
            const h = document.getElementById(`horse-${suit}`); if (!h) return;
            const pos = Math.min(levels, Number(h.dataset.pos) || 0);
            const z = g.zAt(pos), k = g.k(z);
            const xw = g.lane0 + (i + 0.5) * g.laneW;
            h.style.setProperty('--x', g.X(xw, z).toFixed(1) + 'px');
            h.style.setProperty('--y', (g.Y(z) + 3 * k).toFixed(1) + 'px');
            h.style.setProperty('--s', (laneNearPx * k * 0.94 / 120).toFixed(4));
            h.style.zIndex = String(Math.round(1000 - z * 400));
            const lab = document.getElementById(`label-${suit}`);
            if (lab) { const zl = g.zAt(levels) * 0.45; lab.style.setProperty('--x', g.X(xw, zl).toFixed(1) + 'px'); lab.style.setProperty('--y', g.Y(zl).toFixed(1) + 'px'); }
        });
        const gutPx = (g.lane0 + 1) * g.half;
        document.querySelectorAll('#step-cards-container .step-card').forEach(card => {
            const z = g.zAt(Number(card.dataset.k)), k = g.k(z);
            card.style.setProperty('--x', g.X(-1 + (g.lane0 + 1) / 2, z).toFixed(1) + 'px');
            card.style.setProperty('--y', (g.Y(z) - 2).toFixed(1) + 'px');
            card.style.setProperty('--w', Math.max(g.narrow ? 34 : 42, gutPx * 0.8 * (0.5 + 0.5 * k)).toFixed(1) + 'px');
            card.style.zIndex = String(Math.round(1000 - z * 400));
        });
    }
    (() => {
        const st = document.getElementById('race-track');
        if (st && window.ResizeObserver) new ResizeObserver(() => layoutRace()).observe(st);
        window.addEventListener('resize', layoutRace);
    })();

    const updateRaceView = (state) => {
        document.getElementById('race-name-running').textContent = 'En carrera';
        const { positions, lastCard, stepCards } = state.raceData;
        const { levels } = state.settings;
        const track = document.getElementById('race-track');
        if (track) track.dataset.levels = levels;
        const maxPos = Math.max(...Object.values(positions));

        // Posición de los caballos (se colocan en layoutRace)
        for (const suit in positions) {
            const horseEl = document.getElementById(`horse-${suit}`);
            if (!horseEl) continue;
            horseEl.dataset.pos = positions[suit];
            const leading = positions[suit] > 0 && positions[suit] === maxPos;
            horseEl.classList.toggle('is-leading', leading);
            const lab = document.getElementById(`label-${suit}`);
            if (lab) { lab.classList.toggle('is-leading', leading); lab.classList.toggle('is-winner', positions[suit] >= levels); }
            horseEl.classList.remove('horse-run');
            if (positions[suit] >= levels) horseEl.classList.add('horse-finish-animation');
            else horseEl.classList.remove('horse-finish-animation');
        }

        // El caballo que avanza galopa (se fuerza el reinicio de la animación)
        if (lastCard) {
            const movingHorseEl = document.getElementById(`horse-${lastCard.suit}`);
            if (movingHorseEl && lastCard.suit in positions && positions[lastCard.suit] < levels) {
                void movingHorseEl.offsetWidth;
                movingHorseEl.classList.add('horse-run');
            }
        }

        // Última carta sacada
        const lastCardEl = document.getElementById('last-card-drawn');
        if (lastCardEl) {
            if (lastCard) {
                const key = `${lastCard.number}_${lastCard.suit}_${Object.values(positions).join('')}`;
                const isNew = key !== lastCardKey;
                lastCardKey = key;
                lastCardEl.innerHTML = `
                <div class="card-display${isNew ? ' is-new' : ''}">
                    <div class="card-center" style="background-image: url('/images/cartas/${lastCard.number}_${lastCard.suit.toUpperCase()}.png');"></div>
                </div>
                <span class="hr-last-label">Avanza <strong>${horsePlaceholders[lastCard.suit] || lastCard.suit}</strong></span>`;
            } else {
                lastCardEl.innerHTML = '';
            }
        }

        // Cartas de los escalones: se crean una vez y luego solo se voltean (así se ve la animación)
        const stepCardsContainer = document.getElementById('step-cards-container');
        if (stepCardsContainer && stepCards) {
            const sig = stepCards.map(c => `${c.card.number}_${c.card.suit}`).join('|');
            if (stepCardsContainer.dataset.sig !== sig) {
                stepCardsContainer.dataset.sig = sig;
                stepCardsContainer.innerHTML = '';
                stepCards.forEach((stepCardData, idx) => {
                    const cardWrapper = document.createElement('div');
                    cardWrapper.className = 'step-card';
                    cardWrapper.dataset.k = idx + 1;
                    const card = stepCardData.card;
                    cardWrapper.innerHTML = `
                    <div class="step-card-inner">
                        <div class="step-card-face step-card-front"></div>
                        <div class="step-card-face step-card-back" style="background-image: url('/images/cartas/${card.number}_${card.suit.toUpperCase()}.png');"></div>
                    </div>`;
                    stepCardsContainer.appendChild(cardWrapper);
                });
            }
            [...stepCardsContainer.children].forEach((el, idx) => el.classList.toggle('revealed', !!(stepCards[idx] && stepCards[idx].revealed)));
        }

        layoutRace();
    };

    function updateDistributionView(state) {
        document.getElementById('race-name-finished').textContent = 'Reparto de Tragos';
        const resultsBody = document.getElementById('results-body');
        const { players, winners, winnersDistributedDrinks } = state;
        const meAsWinner = winners.find(w => w.uuid === userUUID);

        let html = '';

        if (meAsWinner) {
            if (winnersDistributedDrinks.includes(userUUID)) {
                html = '<div class="hr-wait"><span class="tp-spinner"></span><h3>Tragos repartidos</h3><p>Esperando a que terminen los demás ganadores.</p></div>';
            } else {
                const sipsToDistribute = meAsWinner.sipsWon;
                const otherPlayers = players.filter(p => p.uuid !== userUUID);

                html = `
                    <h3 class="hr-win-title">Has ganado <span class="num">${sipsToDistribute}</span> tragos</h3>
                    <p class="hr-win-sub">Repártelos entre los demás.</p>
                    <div id="distribution-form">
                        <p class="hr-remaining">Quedan <span id="sips-remaining" class="num">${sipsToDistribute}</span></p>
                        <ul class="hr-dist-list">
                `;

                otherPlayers.forEach(p => {
                    html += `
                        <li class="hr-dist-row">
                            <span class="hr-dist-name">${escapeHTML(p.name)}</span>
                            <div class="tp-stepper">
                                <button type="button" data-step="-1" aria-label="Menos">−</button>
                                <input type="number" inputmode="numeric" class="tp-input" data-player-uuid="${p.uuid}" min="0" value="0">
                                <button type="button" data-step="1" aria-label="Más">+</button>
                            </div>
                        </li>
                    `;
                });

                html += `
                        </ul>
                        <button id="distribute-btn" class="btn-custom tp-btn--block">Repartir tragos</button>
                    </div>
                `;
            }
        } else {
            html = '<div class="hr-wait"><span class="tp-spinner"></span><h3>Carrera terminada</h3><p>Los ganadores están repartiendo tragos.</p></div>';
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

        let html = '';
        if (winner) {
            html += `<div class="hr-podium"><img src="/images/cartas/11_${String(winner).toUpperCase()}.png" alt=""><span class="hr-podium-flag"><i class="bi bi-trophy-fill"></i></span></div>`;
        }
        html += `<h1 class="g-question">${winner ? `Gana ${escapeHTML(winner)}` : 'Empate'}</h1>`;
        if (noWinnerBets) {
            html += `<p class="g-sub">Nadie apostó por ${escapeHTML(winner)}. Esta vez no bebe nadie.</p>`;
        } else if (winner) {
            const winningPlayers = state.players.filter(p => p.betOn === winner);
            if (winningPlayers.length > 0) {
                html += '<ul class="hr-winners">';
                winningPlayers.forEach(p => {
                    html += `<li><i class="bi bi-trophy"></i> ${escapeHTML(p.name)}</li>`;
                });
                html += '</ul>';
            }
        } else {
            html += `<p class="g-sub">Nadie bebe esta vez.</p>`;
        }

        // Display received sips
        if (sipDistributionLog && sipDistributionLog.length > 0) {
            const mySips = sipDistributionLog.filter(log => log.to_uuid === userUUID);
            
            if (mySips.length > 0) {
                html += `<div class="sips-received-summary">`;
                html += `<h4>Te toca beber</h4>`;
                
                const sipsBySender = mySips.reduce((acc, log) => {
                    acc[log.from_name] = (acc[log.from_name] || 0) + log.amount;
                    return acc;
                }, {});

                html += `<ul>`;
                for (const from_name in sipsBySender) {
                    const amount = sipsBySender[from_name];
                    html += `<li><span>${escapeHTML(from_name)}</span><strong class="num">${amount}</strong></li>`;
                }
                html += `</ul>`;
                html += `</div>`;
            }
        }

        if (isAdmin) {
            html += `<button id="play-again-btn" class="btn-custom hr-again"><i class="bi bi-arrow-repeat"></i> Otra carrera</button>`;
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
            text: `${from} te manda ${amount} ${amount == 1 ? 'trago' : 'tragos'}`,
            duration: 5000,
            close: true,
            gravity: "top",
            position: "center",
            className: 'tp-toast--drink',
            stopOnFocus: true,
        }).showToast();
    });

    // Estado inicial
    showView('countdown');
});
