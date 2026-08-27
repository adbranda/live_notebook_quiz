import express from 'express';
import http from 'http';
import crypto from 'crypto';
import multer from 'multer';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { parseQuizCsv, validateQuiz } from './quiz.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const sockets = new Map();

app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

function makePin() {
  for (let i = 0; i < 100; i++) {
    const pin = String(100000 + crypto.randomInt(900000));
    if (!rooms.has(pin)) return pin;
  }
  throw new Error('No free game PINs available');
}

function safePlayer(player) {
  return { id: player.id, name: player.name, score: player.score, answered: player.answered };
}

function publicRoom(room) {
  return {
    pin: room.pin,
    title: room.quiz.title,
    state: room.state,
    current: room.current,
    total: room.quiz.questions.length,
    players: [...room.players.values()].map(safePlayer),
    questionEndsAt: room.questionEndsAt,
    answerCounts: room.answerCounts,
    lastResult: room.lastResult
  };
}

function broadcastRoom(room) {
  io.to(room.hostSocket).emit('room:update', publicRoom(room));
  for (const player of room.players.values()) {
    io.to(player.socketId).emit('room:update', publicRoom(room));
  }
}

function emitToRoom(room, event, payload) {
  io.to(room.hostSocket).emit(event, payload);
  for (const player of room.players.values()) io.to(player.socketId).emit(event, payload);
}

function getRoomForSocket(socket) {
  const membership = sockets.get(socket.id);
  return membership ? rooms.get(membership.pin) : null;
}

function cleanName(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function publicQuestion(room) {
  const q = room.quiz.questions[room.current];
  return {
    number: room.current + 1,
    total: room.quiz.questions.length,
    question: q.question,
    hint: q.hint,
    options: q.options,
    endsAt: room.questionEndsAt,
    duration: room.questionDuration
  };
}

function scoring(room, player, now) {
  const q = room.quiz.questions[room.current];
  if (player.answer !== q.correctAnswer) return 0;
  const remaining = Math.max(0, room.questionEndsAt - now);
  const ratio = room.questionDuration ? remaining / room.questionDuration : 0;
  return 500 + Math.round(500 * ratio);
}

function endQuestion(room) {
  if (room.state !== 'question') return;
  clearTimeout(room.timer);
  const q = room.quiz.questions[room.current];
  const now = Date.now();
  for (const player of room.players.values()) {
    if (!player.answered) continue;
    player.pointsThisRound = scoring(room, player, now);
    player.score += player.pointsThisRound;
  }
  room.state = 'results';
  room.lastResult = {
    correctAnswer: q.correctAnswer,
    rationale: q.rationale,
    answerCounts: room.answerCounts,
    leaderboard: [...room.players.values()]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((p, index) => ({ rank: index + 1, id: p.id, name: p.name, score: p.score, pointsThisRound: p.pointsThisRound || 0 }))
  };
  emitToRoom(room, 'question:ended', room.lastResult);
  broadcastRoom(room);
}

function startQuestion(room, index) {
  clearTimeout(room.timer);
  if (index >= room.quiz.questions.length) {
    room.state = 'finished';
    room.current = room.quiz.questions.length - 1;
    room.questionEndsAt = null;
    emitToRoom(room, 'game:finished', {
      leaderboard: [...room.players.values()]
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }))
    });
    broadcastRoom(room);
    return;
  }
  room.current = index;
  room.state = 'question';
  room.questionDuration = room.settings.timePerQuestion * 1000;
  room.questionEndsAt = Date.now() + room.questionDuration;
  room.answerCounts = { A: 0, B: 0, C: 0, D: 0 };
  room.lastResult = null;
  for (const player of room.players.values()) {
    player.answered = false;
    player.answer = null;
    player.pointsThisRound = 0;
  }
  emitToRoom(room, 'question:started', publicQuestion(room));
  broadcastRoom(room);
  room.timer = setTimeout(() => endQuestion(room), room.questionDuration + 50);
}

function removeSocket(socket) {
  const membership = sockets.get(socket.id);
  if (!membership) return;
  sockets.delete(socket.id);
  const room = rooms.get(membership.pin);
  if (!room) return;
  if (membership.role === 'host') {
    emitToRoom(room, 'game:closed', { reason: 'The host disconnected.' });
    clearTimeout(room.timer);
    rooms.delete(room.pin);
    return;
  }
  room.players.delete(membership.playerId);
  broadcastRoom(room);
}

app.post('/api/rooms', upload.single('quiz'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a CSV file.' });
    const quiz = parseQuizCsv(req.file.buffer.toString('utf8'));
    validateQuiz(quiz);
    const pin = makePin();
    const room = {
      pin,
      quiz,
      state: 'lobby',
      current: -1,
      questionEndsAt: null,
      questionDuration: 0,
      answerCounts: { A: 0, B: 0, C: 0, D: 0 },
      lastResult: null,
      players: new Map(),
      hostSocket: null,
      timer: null,
      settings: { timePerQuestion: Math.max(5, Math.min(120, Number(req.body?.timePerQuestion || 20))) },
      createdAt: Date.now()
    };
    rooms.set(pin, room);
    res.json({ pin, title: quiz.title, questionCount: quiz.questions.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/rooms/:pin', (req, res) => {
  const room = rooms.get(req.params.pin);
  if (!room) return res.status(404).json({ error: 'Game not found.' });
  res.json({ pin: room.pin, title: room.quiz.title, state: room.state, players: room.players.size });
});

app.get('/api/rooms/:pin/qr', async (req, res) => {
  const room = rooms.get(req.params.pin);
  if (!room) return res.status(404).end();
  const joinUrl = `${req.protocol}://${req.get('host')}/join.html?pin=${room.pin}`;
  res.type('png').send(await QRCode.toBuffer(joinUrl, { width: 500, margin: 2 }));
});

io.on('connection', socket => {
  socket.on('host:claim', ({ pin }) => {
    const room = rooms.get(String(pin || ''));
    if (!room) return socket.emit('error:message', 'Game not found.');
    if (room.hostSocket && room.hostSocket !== socket.id) return socket.emit('error:message', 'This game already has a host.');
    room.hostSocket = socket.id;
    sockets.set(socket.id, { pin: room.pin, role: 'host' });
    socket.emit('host:ready', publicRoom(room));
  });

  socket.on('player:join', ({ pin, name }) => {
    const room = rooms.get(String(pin || ''));
    const playerName = cleanName(name);
    if (!room) return socket.emit('error:message', 'Game not found.');
    if (!playerName) return socket.emit('error:message', 'Enter a nickname.');
    if (room.state !== 'lobby') return socket.emit('error:message', 'This game has already started.');
    const duplicate = [...room.players.values()].some(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (duplicate) return socket.emit('error:message', 'That nickname is already in use.');
    const id = crypto.randomUUID();
    const player = { id, socketId: socket.id, name: playerName, score: 0, answered: false, answer: null, pointsThisRound: 0 };
    room.players.set(id, player);
    sockets.set(socket.id, { pin: room.pin, role: 'player', playerId: id });
    socket.emit('player:joined', { player: safePlayer(player), room: publicRoom(room) });
    broadcastRoom(room);
  });

  socket.on('host:start', () => {
    const room = getRoomForSocket(socket);
    if (!room || sockets.get(socket.id)?.role !== 'host') return;
    if (!room.players.size) return socket.emit('error:message', 'At least one player must join.');
    startQuestion(room, 0);
  });

  socket.on('host:next', () => {
    const room = getRoomForSocket(socket);
    if (!room || sockets.get(socket.id)?.role !== 'host') return;
    if (room.state === 'question') endQuestion(room);
    else if (room.state === 'results') startQuestion(room, room.current + 1);
  });

  socket.on('host:end-question', () => {
    const room = getRoomForSocket(socket);
    if (!room || sockets.get(socket.id)?.role !== 'host') return;
    endQuestion(room);
  });

  socket.on('player:answer', ({ answer }) => {
    const membership = sockets.get(socket.id);
    const room = membership && rooms.get(membership.pin);
    if (!room || membership.role !== 'player' || room.state !== 'question') return;
    const player = room.players.get(membership.playerId);
    if (!player || player.answered || !['A', 'B', 'C', 'D'].includes(answer)) return;
    if (Date.now() > room.questionEndsAt) return endQuestion(room);
    player.answered = true;
    player.answer = answer;
    room.answerCounts[answer]++;
    socket.emit('answer:accepted', { answer });
    io.to(room.hostSocket).emit('answer:count', { answered: [...room.players.values()].filter(p => p.answered).length, total: room.players.size });
    if ([...room.players.values()].every(p => p.answered)) endQuestion(room);
  });

  socket.on('disconnect', () => removeSocket(socket));
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [pin, room] of rooms) {
    if (!room.hostSocket && room.createdAt < cutoff) rooms.delete(pin);
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Notebook Live Quiz running on http://localhost:${PORT}`));
