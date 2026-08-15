const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Store active rooms and their states
const rooms = {};

// Map of socketId -> { roomCode, playerId }
const socketMap = {};

// Helper to generate random 5-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Roles distribution based on player count
function getRolesForPlayerCount(count) {
    const roles = [];
    if (count >= 3) {
        roles.push('King', 'Police', 'Thief');
    }
    if (count >= 4) {
        roles.push('Queen');
    }
    if (count >= 5) {
        roles.push('Merchant');
    }
    if (count >= 6) {
        for (let i = 5; i < count; i++) {
            roles.push('Civilian');
        }
    }
    return roles;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function broadcastGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit('room_updated', room);
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('create_room', (data, callback) => {
        const { playerName, playerId } = data;
        let roomCode = generateRoomCode();
        while (rooms[roomCode]) {
            roomCode = generateRoomCode();
        }
        
        rooms[roomCode] = {
            roomCode: roomCode,
            state: 'lobby', // 'lobby', 'playing', 'round_end'
            players: [],
            hostPlayerId: playerId,
            policePlayerId: null,
            thiefPlayerId: null
        };
        
        const player = {
            id: playerId,
            socketId: socket.id,
            name: playerName,
            score: 0,
            isHost: true,
            role: null,
            connected: true
        };
        
        rooms[roomCode].players.push(player);
        socket.join(roomCode);
        socketMap[socket.id] = { roomCode, playerId };
        if (typeof callback === 'function') {
            callback({ success: true, roomCode: roomCode, players: rooms[roomCode].players });
        }
        broadcastGameState(roomCode);
    });

    socket.on('join_room', (data, callback) => {
        const roomCode = data.roomCode.toUpperCase();
        const { playerName, playerId } = data;

        if (!rooms[roomCode]) {
            if (typeof callback === 'function') callback({ success: false, message: 'Room not found.' });
            return;
        }

        const room = rooms[roomCode];
        
        // Check if reconnecting
        const existingPlayer = room.players.find(p => p.id === playerId);
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            existingPlayer.connected = true;
            existingPlayer.name = playerName || existingPlayer.name; // Update name if provided
            socket.join(roomCode);
            socketMap[socket.id] = { roomCode, playerId };
            
            console.log(`Player ${existingPlayer.name} reconnected to ${roomCode}`);
            if (typeof callback === 'function') callback({ success: true, roomCode: roomCode, players: room.players, reconnected: true });
            
            // Re-send round data if game is playing
            if (room.state === 'playing') {
                const publicPlayersData = room.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    score: p.score,
                    isHost: p.isHost,
                    isPolice: p.role === 'Police',
                    connected: p.connected
                }));
                socket.emit('round_started', {
                    myRole: existingPlayer.role,
                    policeId: room.policePlayerId,
                    players: publicPlayersData
                });
            }
            
            broadcastGameState(roomCode);
            return;
        }

        if (room.state !== 'lobby') {
            if (typeof callback === 'function') callback({ success: false, message: 'Game already in progress.' });
            return;
        }

        // New player joining
        const player = {
            id: playerId,
            socketId: socket.id,
            name: playerName,
            score: 0,
            isHost: false,
            role: null,
            connected: true
        };

        room.players.push(player);
        socket.join(roomCode);
        socketMap[socket.id] = { roomCode, playerId };
        
        if (typeof callback === 'function') callback({ success: true, roomCode: roomCode, players: room.players });
        broadcastGameState(roomCode);
    });

    socket.on('start_round', (roomCode) => {
        const room = rooms[roomCode];
        const user = socketMap[socket.id];
        if (!room || !user || room.hostPlayerId !== user.playerId) return;
        
        // Add bots if needed
        while (room.players.length < 3) {
            const botNum = room.players.filter(p => p.isBot).length + 1;
            const botPlayer = {
                id: 'bot_' + Math.random().toString(36).substr(2, 9),
                socketId: null,
                name: 'Bot ' + botNum,
                score: 0,
                isHost: false,
                role: null,
                connected: true,
                isBot: true
            };
            room.players.push(botPlayer);
        }

        room.state = 'playing';
        
        // Distribute roles
        let availableRoles = getRolesForPlayerCount(room.players.length);
        availableRoles = shuffleArray(availableRoles);
        
        room.policePlayerId = null;
        room.thiefPlayerId = null;

        room.players.forEach((player, index) => {
            player.role = availableRoles[index];
            if (player.role === 'Police') {
                room.policePlayerId = player.id;
            } else if (player.role === 'Thief') {
                room.thiefPlayerId = player.id;
            }
        });

        // Send state to all players
        const publicPlayersData = room.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            isHost: p.isHost,
            isPolice: p.role === 'Police',
            connected: p.connected,
            isBot: p.isBot
        }));

        room.players.forEach(player => {
            if (player.connected && !player.isBot) {
                io.to(player.socketId).emit('round_started', {
                    myRole: player.role,
                    policeId: room.policePlayerId,
                    players: publicPlayersData
                });
            }
        });
        
        broadcastGameState(roomCode);
        
        // Bot logic if Police is a bot
        const policePlayer = room.players.find(p => p.id === room.policePlayerId);
        if (policePlayer && policePlayer.isBot) {
            setTimeout(() => {
                // If round is still playing and police is still this bot
                if (room.state === 'playing' && room.policePlayerId === policePlayer.id) {
                    // Make a random guess from other players
                    const otherPlayers = room.players.filter(p => p.id !== policePlayer.id);
                    const randomGuess = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
                    handlePoliceGuess(roomCode, policePlayer.id, randomGuess.id);
                }
            }, 3000 + Math.random() * 2000); // 3-5 seconds delay
        }
    });

    // Helper for police guess (used by player and bot)
    function handlePoliceGuess(roomCode, policePlayerId, guessedPlayerId) {
        const room = rooms[roomCode];
        if (!room || room.policePlayerId !== policePlayerId || room.state !== 'playing') return;

        const isCorrect = (guessedPlayerId === room.thiefPlayerId);
        
        // Calculate scores
        room.players.forEach(player => {
            if (player.role === 'Police') {
                player.score += isCorrect ? 2 : 0;
            } else if (player.role === 'Thief') {
                player.score += isCorrect ? 0 : 2;
            } else {
                player.score += 1;
            }
        });

        room.state = 'round_end';

        // Broadcast results
        const results = {
            isCorrect: isCorrect,
            guessedPlayerId: guessedPlayerId,
            thiefId: room.thiefPlayerId,
            players: room.players // Reveal all roles and scores now
        };

        io.to(roomCode).emit('round_ended', results);
        broadcastGameState(roomCode);
    }

    socket.on('police_guess', (data) => {
        const { roomCode, guessedPlayerId } = data;
        const user = socketMap[socket.id];
        if (user) {
            handlePoliceGuess(roomCode, user.playerId, guessedPlayerId);
        }
    });

    socket.on('next_round_lobby', (roomCode) => {
         const room = rooms[roomCode];
         const user = socketMap[socket.id];
         if (!room || !user || room.hostPlayerId !== user.playerId) return;

         room.state = 'lobby';
         room.policePlayerId = null;
         room.thiefPlayerId = null;
         room.players.forEach(p => p.role = null);

         broadcastGameState(roomCode);
    });

    socket.on('finish_game', (roomCode) => {
         const room = rooms[roomCode];
         const user = socketMap[socket.id];
         if (!room || !user || room.hostPlayerId !== user.playerId) return;

         room.state = 'game_over';
         
         // Determine winner(s)
         let maxScore = -1;
         let winners = [];
         
         room.players.forEach(p => {
             if (p.score > maxScore) {
                 maxScore = p.score;
                 winners = [p];
             } else if (p.score === maxScore) {
                 winners.push(p);
             }
         });

         io.to(roomCode).emit('game_finished', {
             winners: winners,
             players: room.players // Final scoreboard
         });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const user = socketMap[socket.id];
        if (user) {
            const room = rooms[user.roomCode];
            if (room) {
                const playerIndex = room.players.findIndex(p => p.id === user.playerId);
                
                if (playerIndex !== -1) {
                    const player = room.players[playerIndex];
                    player.connected = false;
                    
                    if (room.state === 'lobby') {
                        // Remove them completely from lobby
                        room.players.splice(playerIndex, 1);
                        
                        // Re-assign host if host left
                        if (player.id === room.hostPlayerId && room.players.length > 0) {
                            room.players[0].isHost = true;
                            room.hostPlayerId = room.players[0].id;
                        }
                        
                        // Destroy room if empty
                        if (room.players.length === 0) {
                            delete rooms[user.roomCode];
                        } else {
                            broadcastGameState(user.roomCode);
                        }
                    } else {
                        // Game in progress, just mark as disconnected
                        broadcastGameState(user.roomCode);
                        io.to(user.roomCode).emit('player_disconnected', player.id);
                    }
                }
            }
            delete socketMap[socket.id];
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
