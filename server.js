const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { 
                players: [], 
                gmId: socket.id,
                settings: { wolf: 1, madman: 0, hunter: 0, seer: 1, villager: 2, knowEachOther: false }
            };
        }
        const player = { id: socket.id, name: playerName, role: '未配布', isAlive: true, isGM: rooms[roomId].gmId === socket.id };
        rooms[roomId].players.push(player);
        io.to(roomId).emit('update-room', rooms[roomId]);
    });

    socket.on('transfer-gm', ({ roomId, newGmId }) => {
        if (rooms[roomId] && rooms[roomId].gmId === socket.id) {
            rooms[roomId].gmId = newGmId;
            rooms[roomId].players.forEach(p => {
                p.isGM = (p.id === newGmId);
                if(p.isGM) p.role = '進行役（GM）';
            });
            io.to(roomId).emit('update-room', rooms[roomId]);
        }
    });

    socket.on('update-settings', ({ roomId, settings }) => {
        if (rooms[roomId] && rooms[roomId].gmId === socket.id) {
            rooms[roomId].settings = settings;
            io.to(roomId).emit('update-room', rooms[roomId]);
        }
    });

    socket.on('start-game', ({ roomId }) => {
        if (!rooms[roomId] || rooms[roomId].gmId !== socket.id) return;
        const s = rooms[roomId].settings;
        const rolePool = [];
        for(let i=0; i<s.wolf; i++) rolePool.push('人狼');
        for(let i=0; i<s.madman; i++) rolePool.push('狂人');
        for(let i=0; i<s.hunter; i++) rolePool.push('狩人');
        for(let i=0; i<s.seer; i++) rolePool.push('占い師');
        const nonGmPlayers = rooms[roomId].players.filter(p => p.id !== rooms[roomId].gmId);
        if (nonGmPlayers.length === 0) return;
        const remainingSlots = nonGmPlayers.length - rolePool.length;
        for(let i=0; i<remainingSlots; i++) rolePool.push('市民');

        for (let i = rolePool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
        }

        const wolves = [];
        const madmen = [];
        nonGmPlayers.forEach((p, index) => {
            p.role = rolePool[index] || '市民';
            if (p.role === '人狼') wolves.push(p.name);
            if (p.role === '狂人') madmen.push(p.name);
        });

        rooms[roomId].players.find(p => p.id === rooms[roomId].gmId).role = '進行役（GM）';

        nonGmPlayers.forEach(p => {
            let info = "";
            if (p.role === '人狼') {
                const otherWolves = wolves.filter(w => w !== p.name);
                info = otherWolves.length > 0 ? `仲間: ${otherWolves.join(', ')}` : `仲間: 独り`;
                if (s.knowEachOther && madmen.length > 0) info += ` / 狂人: ${madmen.join(', ')}`;
            } else if (p.role === '狂人' && s.knowEachOther) {
                info = wolves.length > 0 ? `主人(狼): ${wolves.join(', ')}` : `主人(狼): 不明`;
            }
            io.to(p.id).emit('assign-role', { role: p.role, info: info });
        });

        io.to(rooms[roomId].gmId).emit('assign-role', { role: '進行役（GM）', info: "" });
        io.to(roomId).emit('update-room', rooms[roomId]);
        io.to(roomId).emit('receive-chat', { senderId: 'system', playerName: 'システム', message: '役職を配布しました。' });
    });

    socket.on('send-chat', ({ roomId, message, playerName }) => {
        io.to(roomId).emit('receive-chat', { senderId: socket.id, playerName, message });
    });

    socket.on('leave-room', ({ roomId }) => handleDisconnect(socket, roomId));
    socket.on('disconnecting', () => socket.rooms.forEach(roomId => handleDisconnect(socket, roomId)));
});

function handleDisconnect(socket, roomId) {
    if (rooms[roomId]) {
        rooms[roomId].players = rooms[roomId].players.filter(p => p.id !== socket.id);
        if (rooms[roomId].players.length === 0) {
            delete rooms[roomId];
        } else if (rooms[roomId].gmId === socket.id && rooms[roomId].players.length > 0) {
            rooms[roomId].gmId = rooms[roomId].players[0].id;
            rooms[roomId].players[0].isGM = true;
            io.to(roomId).emit('update-room', rooms[roomId]);
        } else {
            io.to(roomId).emit('update-room', rooms[roomId]);
        }
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
