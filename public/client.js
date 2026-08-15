const socket = io();

// Generate or retrieve unique player ID for reconnects
let playerId = localStorage.getItem('thief_police_player_id');
if (!playerId) {
    playerId = 'player_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('thief_police_player_id', playerId);
}

// State
let currentRoomCode = null;
let isHost = false;
let myName = '';
let myRole = null;
let currentPlayers = [];
let gameInProgress = false;

// DOM Elements
const screens = {
    landing: document.getElementById('landing-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    roundEnd: document.getElementById('round-end-screen'),
    gameOver: document.getElementById('game-over-screen')
};

// Landing
const inputName = document.getElementById('player-name');
const btnCreate = document.getElementById('btn-create-room');
const inputRoomCode = document.getElementById('room-code-input');
const btnJoin = document.getElementById('btn-join-room');

// Lobby
const displayRoomCode = document.getElementById('display-room-code');
const lobbyPlayersList = document.getElementById('lobby-players-list');
const playerCountSpan = document.getElementById('player-count');
const btnStartGame = document.getElementById('btn-start-game');
const waitingMsg = document.getElementById('waiting-msg');

// Game (Rummy Table)
const seatsContainer = document.getElementById('seats-container');
const actionBanner = document.getElementById('action-banner');
const gameLeaderboard = document.getElementById('game-leaderboard');

// Round End
const guessResultDisplay = document.getElementById('guess-result');
const revealedRolesList = document.getElementById('revealed-roles-list');
const endLeaderboard = document.getElementById('end-leaderboard');
const btnNextRound = document.getElementById('btn-next-round');
const btnFinishGame = document.getElementById('btn-finish-game');
const endWaitingMsg = document.getElementById('end-waiting-msg');

// Game Over
const winnerNameDisplay = document.getElementById('winner-name');
const finalLeaderboard = document.getElementById('final-leaderboard');
const btnBackToLobby = document.getElementById('btn-back-to-lobby');

// Utils
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 300);
}

function renderPlayersList(players) {
    lobbyPlayersList.innerHTML = '';
    playerCountSpan.textContent = players.length;
    
    players.forEach(p => {
        const li = document.createElement('li');
        let text = p.name;
        if (!p.connected) text += ' (Disconnected)';
        
        li.innerHTML = `<span>${text}</span> ${p.isHost ? '<span class="host-badge">Host</span>' : ''}`;
        lobbyPlayersList.appendChild(li);
    });
}

function renderLeaderboard(players, containerElement) {
    containerElement.innerHTML = '';
    const sorted = [...players].sort((a, b) => b.score - a.score);
    
    sorted.forEach(p => {
        const li = document.createElement('li');
        let text = p.name;
        if (!p.connected) text += ' (DC)';
        li.innerHTML = `<span>${text}</span> <strong>${p.score} pts</strong>`;
        containerElement.appendChild(li);
    });
}

// Role config mapping
const ROLE_CONFIG = {
    'Police': { icon: 'fa-shield-halved', class: 'role-police' },
    'Thief': { icon: 'fa-user-ninja', class: 'role-thief' },
    'King': { icon: 'fa-chess-king', class: 'role-king' },
    'Queen': { icon: 'fa-chess-queen', class: 'role-queen' },
    'Merchant': { icon: 'fa-coins', class: 'role-merchant' },
    'Civilian': { icon: 'fa-user', class: 'role-civilian' }
};

// Audio Context for sound effects
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playAlertSound() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
    oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
}

// Event Listeners - Landing
btnCreate.addEventListener('click', () => {
    // Resume audio context on user interaction
    if (audioCtx.state === 'suspended') audioCtx.resume();
    myName = inputName.value.trim() || 'Player';
    socket.emit('create_room', { playerName: myName, playerId });
});

btnJoin.addEventListener('click', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const code = inputRoomCode.value.trim();
    if (!code) return showToast('Enter a room code');
    
    myName = inputName.value.trim() || 'Player';
    socket.emit('join_room', { roomCode: code, playerName: myName, playerId }, (res) => {
        if (!res.success) {
            showToast(res.message);
        }
    });
});

// Event Listeners - Lobby
btnStartGame.addEventListener('click', () => {
    socket.emit('start_round', currentRoomCode);
});

// Event Listeners - Round End & Game Over
btnNextRound.addEventListener('click', () => {
    socket.emit('next_round_lobby', currentRoomCode);
});
btnFinishGame.addEventListener('click', () => {
    socket.emit('finish_game', currentRoomCode);
});
btnBackToLobby.addEventListener('click', () => {
    currentRoomCode = null;
    isHost = false;
    showScreen('landing');
});

// Socket Events
socket.on('room_updated', (room) => {
    currentPlayers = room.players;
    
    // Update host status
    const me = room.players.find(p => p.id === playerId);
    if (me) isHost = me.isHost;
    
    if (room.state === 'lobby') {
        currentRoomCode = room.roomCode;
        displayRoomCode.textContent = room.roomCode;
        gameInProgress = false;
        
        renderPlayersList(room.players);
        
        if (isHost) {
            btnStartGame.classList.remove('hidden');
            waitingMsg.classList.add('hidden');
        } else {
            btnStartGame.classList.add('hidden');
            waitingMsg.classList.remove('hidden');
        }
        
        showScreen('lobby');
    }
});

socket.on('round_started', (data) => {
    const { myRole: role, policeId, players } = data;
    myRole = role;
    gameInProgress = true;
    
    // Hide UI elements initially
    actionBanner.classList.add('hidden');
    actionBanner.classList.remove('animate-in'); // Reset animation
    seatsContainer.innerHTML = '';
    renderLeaderboard(players, gameLeaderboard);
    showScreen('game');

    // 1. Calculate positions
    // Local player is always at the bottom center
    const localPlayer = players.find(p => p.id === playerId);
    const otherPlayers = players.filter(p => p.id !== playerId);
    
    // Create local player seat
    createSeat(localPlayer, true, role, '50%', '85%', policeId === localPlayer.id);

    // Create other player seats along an arc (ellipse)
    const totalOthers = otherPlayers.length;
    const a = 40; // x-radius % (e.g. 50% +- 40%)
    const b = 30; // y-radius % (e.g. 50% +- 30%)
    const yCenter = 45;
    const xCenter = 50;
    
    otherPlayers.forEach((p, index) => {
        let angle;
        if (totalOthers === 1) {
            angle = Math.PI / 2;
        } else if (totalOthers === 2) {
            angle = Math.PI * 0.75 - (index * (Math.PI / 2));
        } else {
            angle = Math.PI - (index * (Math.PI / (totalOthers - 1)));
        }

        const xPos = xCenter + a * Math.cos(angle);
        const yPos = yCenter - b * Math.sin(angle);

        const isPolice = (p.id === policeId);
        createSeat(p, false, isPolice ? 'Police' : null, `${xPos}%`, `${yPos}%`, isPolice);
    });

    // 2. Deal Animation
    setTimeout(() => {
        const cards = document.querySelectorAll('.card-container');
        cards.forEach(card => {
            // Remove the deal animation class to let it transition to its seat position
            card.classList.remove('deal-anim');
            card.style.transform = 'translateY(0) scale(1)'; 
        });

        // 3. Reveal local and Police cards after deal finishes
        setTimeout(() => {
            // Flip local player
            const localCard = document.querySelector(`.seat[data-id="${playerId}"] .card-container`);
            if (localCard) localCard.classList.add('flipped');

            // Flip police card
            const policeCard = document.querySelector(`.seat[data-id="${policeId}"] .card-container`);
            if (policeCard) policeCard.classList.add('flipped');

            // Show action banner with sound
            actionBanner.classList.remove('hidden');
            actionBanner.classList.add('animate-in');
            playAlertSound();

            // 4. Enable guessing if local player is Police
            if (myRole === 'Police') {
                const opponentSeats = document.querySelectorAll('.seat:not(.seat-local)');
                opponentSeats.forEach(seat => {
                    seat.classList.add('guessable');
                    seat.addEventListener('click', () => {
                        const targetId = seat.getAttribute('data-id');
                        socket.emit('police_guess', {
                            roomCode: currentRoomCode,
                            guessedPlayerId: targetId
                        });
                        // Remove guessable class to prevent multiple clicks
                        opponentSeats.forEach(s => s.classList.remove('guessable'));
                    });
                });
            }
        }, 800); // Wait for dealing animation to finish
    }, 100);
});

function createSeat(player, isLocal, knownRole, leftPercent, topPercent, isPolice) {
    const seat = document.createElement('div');
    seat.className = `seat ${isLocal ? 'seat-local' : ''}`;
    seat.setAttribute('data-id', player.id);
    seat.style.left = leftPercent;
    seat.style.top = topPercent;

    // The card
    const cardContainer = document.createElement('div');
    cardContainer.className = 'card-container deal-anim'; // Start with deal anim (hidden at center)
    
    const cardInner = document.createElement('div');
    cardInner.className = 'card-inner';

    // Back of card
    const cardBack = document.createElement('div');
    cardBack.className = 'card-face card-back';
    cardBack.innerHTML = `<i class="fa-solid fa-user-secret"></i>`;

    // Front of card (Role)
    const cardFront = document.createElement('div');
    cardFront.className = 'card-face card-front';
    
    // We only attach the role info if it's known (local player or Police)
    // Note: To prevent cheating by inspecting DOM, server should only send roles that are public.
    // For now, if knownRole is set, render it.
    if (knownRole) {
        const conf = ROLE_CONFIG[knownRole] || ROLE_CONFIG['Civilian'];
        cardContainer.classList.add(conf.class);
        cardFront.innerHTML = `
            <i class="fa-solid ${conf.icon}"></i>
            <div class="role-title">${knownRole}</div>
        `;
    }

    cardInner.appendChild(cardBack);
    cardInner.appendChild(cardFront);
    cardContainer.appendChild(cardInner);

    // Name tag
    const nameTag = document.createElement('div');
    nameTag.className = 'player-name-tag glow-text';
    nameTag.textContent = player.name + (player.connected ? '' : ' (DC)');

    seat.appendChild(cardContainer);
    seat.appendChild(nameTag);
    seatsContainer.appendChild(seat);
}

socket.on('round_ended', (results) => {
    const { isCorrect, guessedPlayerId, thiefId, players } = results;
    gameInProgress = false;

    // 1. Hide Banner
    actionBanner.classList.add('hidden');

    // 2. Reveal all remaining cards on the table
    players.forEach(p => {
        const seat = document.querySelector(`.seat[data-id="${p.id}"]`);
        if (seat) {
            const cardContainer = seat.querySelector('.card-container');
            const cardFront = seat.querySelector('.card-front');
            
            // Update the front to their actual role
            const conf = ROLE_CONFIG[p.role] || ROLE_CONFIG['Civilian'];
            // Remove previous classes
            cardContainer.className = `card-container flipped ${conf.class}`;
            cardFront.innerHTML = `
                <i class="fa-solid ${conf.icon}"></i>
                <div class="role-title">${p.role}</div>
            `;
        }
    });

    // 3. Wait 3 seconds, then show Round End screen
    setTimeout(() => {
        const thief = players.find(p => p.id === thiefId);
        const guessed = players.find(p => p.id === guessedPlayerId);
        
        if (isCorrect) {
            guessResultDisplay.textContent = `The Police guessed correctly! ${thief.name} was the Thief.`;
            guessResultDisplay.style.color = 'var(--police-color)';
        } else {
            guessResultDisplay.textContent = `The Police guessed wrong! They guessed ${guessed ? guessed.name : 'Unknown'}, but the Thief was ${thief.name}.`;
            guessResultDisplay.style.color = 'var(--thief-color)';
        }

        revealedRolesList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `${p.name} <br> <span class="role-tag">${p.role}</span>`;
            revealedRolesList.appendChild(li);
        });

        renderLeaderboard(players, endLeaderboard);

        if (isHost) {
            btnNextRound.classList.remove('hidden');
            btnFinishGame.classList.remove('hidden');
            endWaitingMsg.classList.add('hidden');
        } else {
            btnNextRound.classList.add('hidden');
            btnFinishGame.classList.add('hidden');
            endWaitingMsg.classList.remove('hidden');
        }

        showScreen('roundEnd');
    }, 3000);
});

socket.on('game_finished', (data) => {
    const { winners, players } = data;
    
    winnerNameDisplay.textContent = winners.map(w => w.name).join(' & ');
    renderLeaderboard(players, finalLeaderboard);
    
    showScreen('gameOver');
});

socket.on('error_message', (msg) => {
    showToast(msg);
});

socket.on('player_disconnected', (disconnectedPlayerId) => {
    showToast('A player disconnected.');
});
