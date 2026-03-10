document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    let countdownActive = false; // New flag to prevent countdown restart

    socket.on('roomState', (state) => {
        console.log('Estado de la votación recibido:', state);
        if (!state || state.game !== 'voting') return;

        if (state.phase === 'finished') {
            showVotingResults(state);
            countdownActive = false; // Reset flag when voting finishes
            waitingMessageContainer.style.display = 'none'; // Ensure waiting message is hidden
            gameContainer.style.display = 'block'; // Reset gameContainer display for results
        } else if (state.phase === 'voting') {
            waitingMessageContainer.style.display = 'none'; // Hide waiting message
            optionsGrid.style.display = 'grid'; // Show options grid
            gameContainer.style.display = 'grid'; // Set gameContainer to grid for options
            updateVotingView(state);
            // Ensure the countdown container has the necessary HTML structure
            if (countdownContainer.innerHTML === '' || !countdownContainer.querySelector('.countdown-progress-bar')) {
                countdownContainer.innerHTML = `
                    <div class="countdown-bar">
                        <div class="countdown-progress-bar"></div>
                    </div>
                    <div class="countdown-text"></div>
                `;
            }
            if (!countdownActive) { // Only start countdown if not already active
                startCountdown(state.endTime);
                countdownActive = true;
            }
        } else if (state.phase === 'waiting') {
            gamePageTitle.textContent = state.title || 'Votación en espera'; // Update page title for waiting phase
            countdownContainer.innerHTML = ''; // Clear previous content
            const isAdmin = state.roomAdminId === userUUID;
            let waitingHTML = '<div class="text-center"><h2>Esperando a que el administrador inicie la votación...</h2>';
            if (isAdmin) {
                waitingHTML += '<button id="start-voting-btn" class="btn btn-primary btn-lg mt-4">Iniciar Votación</button>';
            }
            waitingHTML += '</div>';
            waitingMessageContainer.innerHTML = waitingHTML; // Populate waiting message container
            waitingMessageContainer.style.display = 'block'; // Show waiting message
            optionsGrid.style.display = 'none'; // Hide options grid
            gameContainer.style.display = 'block'; // Set gameContainer to block for waiting message
            countdownActive = false; // Reset flag when in waiting phase

            if (state.originalSettings) {
                localStorage.setItem('lastVotingSettings', JSON.stringify(state.originalSettings));
            }

            if (isAdmin) {
                const startBtn = waitingMessageContainer.querySelector('#start-voting-btn'); // Select button from within waitingMessageContainer
                if (startBtn) {
                    startBtn.addEventListener('click', () => {
                        console.log('Attempting to start voting for room:', ROOM_ID, 'by user:', userUUID);
                        socket.emit('startVoting', { roomId: ROOM_ID, userId: userUUID });
                    });
                }
            }
        }
    });

    // --- UUID de Usuario ---
    let userUUID = localStorage.getItem('userUUID');
    if (!userUUID) {
        userUUID = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('userUUID', userUUID);
    }

    // Client-side validation for ROOM_ID
    if (!ROOM_ID || ROOM_ID === 'undefined' || ROOM_ID === 'null') {
        console.error('Client-side error: ROOM_ID is invalid. Redirecting.');
        alert('Error: ID de sala no válido. Redirigiendo a la página principal.');
        window.location.href = '/';
        return; // Stop further execution
    }

    // --- Elementos del DOM ---
    const gameContainer = document.getElementById('game-container');
    const gamePageTitle = document.getElementById('game-page-title');
    const countdownContainer = document.getElementById('game-countdown');

    // Clear any initial content from the EJS template
    gameContainer.innerHTML = '';

    // Create or get the options grid container once
    let optionsGrid = gameContainer.querySelector('.options-grid');
    if (!optionsGrid) {
        optionsGrid = document.createElement('div');
        optionsGrid.className = 'options-grid';
        optionsGrid.style.display = 'none'; // Initially hidden
        gameContainer.appendChild(optionsGrid);
    }

    let waitingMessageContainer = gameContainer.querySelector('.waiting-message-container');
    if (!waitingMessageContainer) {
        waitingMessageContainer = document.createElement('div');
        waitingMessageContainer.className = 'waiting-message-container';
        gameContainer.prepend(waitingMessageContainer); // Add at the beginning
    }

    // Only proceed if the main voting elements are present on the page
    if (!gameContainer || !gamePageTitle || !countdownContainer) {
        console.warn('Voting page elements not found. Skipping voting script initialization.');
        return; // Exit if not on the voting page
    }

    // --- Lógica de Conexión y Sala ---
    socket.on('connect', () => {
        console.log('Conectado al servidor. Uniendo a la sala de votación...');
        const storedPassword = sessionStorage.getItem(`roomPassword_${ROOM_ID}`); // Retrieve stored password
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
            sessionStorage.setItem(`roomPassword_${ROOM_ID}`, password); // Store new password
            // Re-emit joinRoom with new password
            socket.emit('joinRoom', { gameType: GAME_TYPE, roomId: ROOM_ID, user: { uuid: userUUID, password } });
        } else {
            alert(`Error: ${message}\nRedirigiendo a la página principal.`);
            window.location.href = '/';
        }
    });

    // --- Funciones de UI ---
    function escapeHTML(str) {
        return str.toString().replace(/[&<"'\/]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;', '/': '&#x2F;' }[s]));
    }

    const handleVote = (optionName) => {
        socket.emit('submitVote', { roomId: ROOM_ID, optionName, uuid: userUUID });
    };

    const showVotingResults = (state) => {
        clearInterval(countdownInterval);
        countdownContainer.innerHTML = "VOTACIÓN CERRADA";
        gamePageTitle.textContent = "Resultados de la Votación";

        const { options, roomAdminId } = state;
        const isAdmin = roomAdminId === userUUID;

        let winner = { name: 'Nadie (empate)', votes: -1 };
        let isTie = false;

        if (options && options.length > 0) {
            const sortedOptions = [...options].sort((a, b) => b.votes - a.votes);
            if (sortedOptions[0].votes > 0) {
                const topVoteCount = sortedOptions[0].votes;
                const winners = sortedOptions.filter(opt => opt.votes === topVoteCount);
                if (winners.length === 1) {
                    winner = winners[0];
                } else {
                    isTie = true;
                    winner.name = winners.map(w => escapeHTML(w.name)).join(', ');
                    winner.votes = topVoteCount;
                }
            }
        } else {
             winner.name = 'Nadie ha votado';
             winner.votes = 0;
        }

        let resultsHTML = `
            <div id="voting-results-display" class="results-winner text-center">
                <h2>${isTie ? 'Ganadores:' : 'Ganador:'}</h2>
                <h1 class="display-1 my-3">${escapeHTML(winner.name)}</h1>
                <p class="lead">Con ${winner.votes} voto(s)</p>
            </div>
        `;

        if (isAdmin) {
            // Save current settings to localStorage for pre-filling the next form
            localStorage.setItem('lastVotingSettings', JSON.stringify(state.settings));
            resultsHTML += `<div class="text-center mt-4"><button id="play-again-voting-btn" class="btn btn-primary btn-lg">Crear Nueva Votación</button></div>`;
        }

        // Ensure optionsGrid is hidden and results are shown
        optionsGrid.style.display = 'none';
        let resultsDisplay = gameContainer.querySelector('#voting-results-display');
        if (!resultsDisplay) {
            resultsDisplay = document.createElement('div');
            resultsDisplay.id = 'voting-results-display';
            gameContainer.appendChild(resultsDisplay);
        }
        resultsDisplay.innerHTML = resultsHTML;
        resultsDisplay.style.display = 'block';

        if (isAdmin) {
            document.getElementById('play-again-voting-btn').addEventListener('click', () => {
                window.location.href = `/admin/voting?update_room_id=${ROOM_ID}`;
            });
        }
    }

    const updateVotingView = (state) => {
        gamePageTitle.textContent = state.title || 'Votación';

        // Hide results display if it exists
        const resultsDisplay = gameContainer.querySelector('#voting-results-display');
        if (resultsDisplay) {
            resultsDisplay.style.display = 'none';
        }
        optionsGrid.style.display = 'grid'; // Ensure options grid is visible

        // Apply responsive class based on number of options
        if (state.options.length < 8) {
            optionsGrid.classList.add('column-layout');
            optionsGrid.classList.remove('two-column-layout'); // Ensure two-column is removed
        } else {
            optionsGrid.classList.remove('column-layout');
            optionsGrid.classList.add('two-column-layout'); // Ensure two-column is added for 8+ options
        }

        const totalVotes = state.options.reduce((sum, opt) => sum + opt.votes, 0);
        const currentUserVote = state.votes[userUUID];

        // Keep track of options that are still present in the new state
        const newOptionNames = new Set(state.options.map(opt => opt.name));
        const existingOptionElements = Array.from(optionsGrid.children);

        // Remove options that are no longer in the state
        existingOptionElements.forEach(el => {
            const optionName = el.dataset.option;
            if (!newOptionNames.has(optionName)) {
                el.remove();
            }
        });

        // Update or create options
        state.options.forEach(option => {
            const percentage = totalVotes > 0 ? ((option.votes / totalVotes) * 100) : 0;
            const isVoted = currentUserVote === option.name;

            let optionEl = optionsGrid.querySelector(`.option-btn-progress[data-option="${escapeHTML(option.name)}"]`);

            if (!optionEl) {
                // Create new option element if it doesn't exist
                optionEl = document.createElement('div');
                optionEl.className = 'option-btn-progress';
                optionEl.dataset.option = escapeHTML(option.name);
                optionEl.innerHTML = `
                    <div class="progress-bar" style="width: ${percentage.toFixed(1)}%;"></div>
                    <div class="option-content">
                        <span class="option-name">${escapeHTML(option.name)}</span>
                        <span class="vote-percentage">${option.votes} Votos</span>
                    </div>
                `;
                optionEl.addEventListener('click', () => handleVote(optionEl.dataset.option));
                optionsGrid.appendChild(optionEl);
            } else {
                // Update existing option element
                const progressBar = optionEl.querySelector('.progress-bar');
                const optionNameSpan = optionEl.querySelector('.option-name');
                const votePercentageSpan = optionEl.querySelector('.vote-percentage');

                if (progressBar) progressBar.style.width = `${percentage.toFixed(1)}%`;
                if (optionNameSpan) optionNameSpan.textContent = escapeHTML(option.name);
                if (votePercentageSpan) votePercentageSpan.textContent = `${option.votes} Votos`;
            }

            // Update voted class
            if (isVoted) {
                optionEl.classList.add('voted');
            } else {
                optionEl.classList.remove('voted');
            }
        });
    };

    let countdownInterval;
    const startCountdown = (endTime) => {
        clearInterval(countdownInterval);
        const countdownProgressBar = countdownContainer.querySelector('.countdown-progress-bar');
        const countdownText = countdownContainer.querySelector('.countdown-text');
        const totalDuration = new Date(endTime).getTime() - Date.now();

        const updateTimer = () => {
            const now = Date.now();
            const distance = new Date(endTime).getTime() - now;

            if (distance < 0) {
                clearInterval(countdownInterval);
                if (countdownText) countdownText.textContent = "VOTACIÓN CERRADA";
                if (countdownProgressBar) countdownProgressBar.style.width = '0%';
                return;
            }

            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);
            const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            if (countdownText) countdownText.textContent = formattedTime;

            const remainingPercentage = (distance / totalDuration) * 100;
            if (countdownProgressBar) countdownProgressBar.style.width = `${remainingPercentage}%`;
        };

        updateTimer();
        countdownInterval = setInterval(updateTimer, 1000);
    };
});