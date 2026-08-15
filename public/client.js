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
    gameOver: document.getElementById('game-over-screen')
};

// Landing
const inputName = document.getElementById('player-name');
const btnCreate = document.getElementById('btn-create-room');
const inputRoomCode = document.getElementById('room-code-input');
const btnJoin = document.getElementById('btn-join-room');

function rejoinRoom(code, name) {
    document.getElementById('room-code').value = code;
    document.getElementById('player-name').value = name;
    joinRoom();
}

function deleteRoom(code) {
    if (confirm("Are you sure you want to delete Room " + code + "?")) {
        socket.emit('delete_room', code);
    }
}

socket.on('room_deleted', () => {
    showToast("The host has deleted this room.", "error");
    setTimeout(() => {
        location.reload();
    }, 2000);
});

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

// Round End / Continuous
const btnInGameFinish = document.getElementById('btn-in-game-finish');

// Chat & Reactions
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const emoteButtons = document.querySelectorAll('.btn-emote');

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
    'Police': { image: 'Police.png', class: 'role-police' },
    'Thief': { image: 'Thief.png', class: 'role-thief' },
    'King': { image: 'King.png', class: 'role-king' },
    'Queen': { image: 'Queen.png', class: 'role-queen' },
    'Merchant': { image: 'Merchant.png', class: 'role-merchant' },
    'Civilian': { image: 'Civilian.jpg', class: 'role-civilian' }
};

// Audio Context for sound effects
let audioCtx = null;
function initAudio() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            audioCtx = new AudioContext();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.warn(e));
    }
}

function playAlertSound() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.warn(e));
    }
    
    try {
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
    } catch (e) {
        console.warn("Audio playback failed", e);
    }
}

// Event Listeners - Landing
btnCreate.addEventListener('click', () => {
    // Initialize audio context on user interaction
    initAudio();
    myName = inputName.value.trim() || 'Player';
    socket.emit('create_room', { playerName: myName, playerId });
});

btnJoin.addEventListener('click', () => {
    initAudio();
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

// Event Listeners - In Game
btnInGameFinish.addEventListener('click', () => {
    socket.emit('finish_game', currentRoomCode);
});
btnBackToLobby.addEventListener('click', () => {
    // Basic reload for now
    window.location.reload();
});

// Chat & Reactions Events
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg || !gameInProgress) return;
    
    socket.emit('chat_message', { roomCode: currentRoomCode, message: msg });
    chatInput.value = '';
});

emoteButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (!gameInProgress) return;
        const emote = btn.getAttribute('data-emote');
        socket.emit('reaction', { roomCode: currentRoomCode, emote });
    });
});

// Real-time Chat
socket.on('chat_message', (data) => {
    const { sender, message } = data;
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    msgEl.innerHTML = `<span class="chat-msg-sender">${sender}:</span><span class="chat-msg-text">${message}</span>`;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Real-time Reactions
socket.on('reaction', (data) => {
    const { sender, emote } = data;
    
    const emoteEl = document.createElement('div');
    emoteEl.className = 'floating-emote';
    emoteEl.textContent = emote;
    
    // Add name tag
    const nameEl = document.createElement('div');
    nameEl.className = 'floating-emote-name';
    nameEl.textContent = sender;
    emoteEl.appendChild(nameEl);
    
    // Random horizontal position for visual variety
    const randomLeft = 10 + Math.random() * 80; // 10% to 90%
    emoteEl.style.left = `${randomLeft}%`;
    
    document.body.appendChild(emoteEl);
    
    // Remove after animation (2.5s)
    setTimeout(() => {
        if (emoteEl.parentNode) {
            emoteEl.parentNode.removeChild(emoteEl);
        }
    }, 2500);
});

socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('request_available_rooms', playerId);
});

socket.on('available_rooms', (roomsList) => {
    const container = document.getElementById('available-rooms-container');
    const list = document.getElementById('available-rooms-list');
    
    if (!roomsList || roomsList.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    list.innerHTML = '';
    
    roomsList.forEach(r => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '10px';
        li.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
        
        const isReconnect = r.hasReconnectSlot;
        
        let html = `<div>
            <strong>Room ${r.roomCode}</strong> 
            <span style="opacity:0.7; font-size:0.8rem; margin-left:10px;">${r.playerCount} Players • ${r.state}</span>
        </div>`;
        
        if (isReconnect) {
            html += `<button class="btn primary-btn glow-btn" style="padding: 5px 10px; font-size: 0.8rem; width: auto;" onclick="rejoinRoom('${r.roomCode}', '${r.reconnectName}')">Reconnect</button>`;
        } else if (r.state === 'lobby') {
            html += `<button class="btn secondary-btn" style="padding: 5px 10px; font-size: 0.8rem; width: auto;" onclick="joinAvailableRoom('${r.roomCode}')">Join</button>`;
        } else {
            html += `<span style="font-size:0.8rem; color:#f87171;">In Progress</span>`;
        }

        if (r.isHost) {
            html += `<button class="btn" style="padding: 5px 10px; font-size: 0.8rem; width: auto; background-color: #ef4444; color: white; margin-left: 10px;" onclick="deleteRoom('${r.roomCode}')">Delete</button>`;
        }

        li.innerHTML = html;
        list.appendChild(li);
    });
});

window.rejoinRoom = function(roomCode, reconnectName) {
    initAudio();
    inputName.value = reconnectName;
    socket.emit('join_room', { roomCode, playerName: reconnectName, playerId });
};

window.joinAvailableRoom = function(roomCode) {
    initAudio();
    const myName = inputName.value.trim() || 'Player';
    socket.emit('join_room', { roomCode, playerName: myName, playerId });
};

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
    const { roundNumber, myRole: role, policeId, players } = data;
    myRole = role;
    gameInProgress = true;
    
    // Hide UI elements initially
    actionBanner.classList.add('hidden');
    actionBanner.classList.remove('animate-in'); // Reset animation
    seatsContainer.innerHTML = '';
    renderLeaderboard(players, gameLeaderboard);
    
    if (isHost) {
        btnInGameFinish.classList.remove('hidden');
    } else {
        btnInGameFinish.classList.add('hidden');
    }

    showScreen('game');

    // Show Round Banner
    actionBanner.classList.remove('animate-in');
    void actionBanner.offsetWidth; // Trigger reflow
    
    actionBanner.innerHTML = `<h2 class="glow-text">ROUND ${roundNumber}</h2>`;
    actionBanner.classList.remove('hidden');
    actionBanner.classList.add('animate-in');
    
    // Delay slightly to let players see "Round X" before dealing
    setTimeout(() => {
        actionBanner.classList.add('hidden');
        actionBanner.classList.remove('animate-in');
        
        // 1. Calculate positions
    // Local player is always at the bottom center
    const localPlayer = players.find(p => p.id === playerId);
    const otherPlayers = players.filter(p => p.id !== playerId);
    
    // Create local player seat
    createSeat(localPlayer, true, role, '50%', '85%', policeId === localPlayer.id);

    // Create other player seats along an arc (ellipse)
    const totalOthers = otherPlayers.length;
    const a = 28; // x-radius % (e.g. 50% +- 28%)
    const b = 25; // y-radius % (e.g. 50% +- 25%)
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
            actionBanner.classList.remove('animate-in');
            void actionBanner.offsetWidth; // Trigger reflow
            actionBanner.innerHTML = `<h2 class="glow-text">CATCH THE THIEF!</h2>`;
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
    }, 2000); // 2 second delay for "Round X" banner
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
            <img class="role-image" src="${conf.image}" alt="${knownRole}">
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
                <img class="role-image" src="${conf.image}" alt="${p.role}">
                <div class="role-title">${p.role}</div>
            `;
        }
    });

    // 3. Show Result Banner & Update Leaderboard
    const thief = players.find(p => p.id === thiefId);
    
    actionBanner.classList.remove('animate-in');
    // Trigger reflow to restart animation
    void actionBanner.offsetWidth; 

    if (isCorrect) {
        actionBanner.innerHTML = `<h2 class="glow-text" style="color: var(--police-color); text-shadow: 0 0 10px var(--police-color);">POLICE WON!</h2>`;
    } else {
        actionBanner.innerHTML = `<h2 class="glow-text" style="color: var(--thief-color); text-shadow: 0 0 10px var(--thief-color);">THIEF ESCAPED!</h2>`;
    }
    
    actionBanner.classList.remove('hidden');
    actionBanner.classList.add('animate-in');

    renderLeaderboard(players, gameLeaderboard);
});

socket.on('game_finished', (data) => {
    const { winners, players } = data;
    
    winnerNameDisplay.innerHTML = `🏆 ${winners.map(w => w.name).join(' & ')} 🏆`;
    renderLeaderboard(players, finalLeaderboard);
    
    showScreen('gameOver');
});

socket.on('error_message', (msg) => {
    showToast(msg);
});

socket.on('player_disconnected', (disconnectedPlayerId) => {
    showToast('A player disconnected.');
});
