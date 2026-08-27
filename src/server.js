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
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 5 * 60 * 1000);
const rooms = new Map();
const sockets = new Map();

app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

function token() { return crypto.randomBytes(24).toString('base64url'); }
function makePin() {
  for (let i = 0; i < 100; i++) {
    const pin = String(100000 + crypto.randomInt(900000));
    if (!rooms.has(pin)) return pin;
  }
  throw new Error('No free game PINs available');
}
function safePlayer(player) {
  return { id: player.id, name: player.name, score: player.score, answered: player.answered, connected: Boolean(player.socketId) };
}
function publicRoom(room) {
  return {
    pin: room.pin, title: room.quiz.title, state: room.state, current: room.current,
    total: room.quiz.questions.length, players: [...room.players.values()].map(safePlayer),
    questionEndsAt: room.questionEndsAt, answerCounts: room.answerCounts, lastResult: room.lastResult
  };
}
function broadcastRoom(room) {
  if (room.hostSocket) io.to(room.hostSocket).emit('room:update', publicRoom(room));
  for (const player of room.players.values()) if (player.socketId) io.to(player.socketId).emit('room:update', publicRoom(room));
}
function emitToRoom(room, event, payload) {
  if (room.hostSocket) io.to(room.hostSocket).emit(event, payload);
  for (const player of room.players.values()) if (player.socketId) io.to(player.socketId).emit(event, payload);
}
function getRoomForSocket(socket) {
  const membership = sockets.get(socket.id);
  return membership ? rooms.get(membership.pin) : null;
}
function cleanName(raw) { return String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 24); }
function publicQuestion(room) {
  const q = room.quiz.questions[room.current];
  return { number: room.current + 1, total: room.quiz.questions.length, question: q.question, hint: q.hint, options: q.options, endsAt: room.questionEndsAt, duration: room.questionDuration };
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
    question: q.question,
    correctAnswer: q.correctAnswer,
    correctAnswerText: q.options[q.correctAnswer],
    rationale: q.rationale, answerCounts: room.answerCounts,
    leaderboard: [...room.players.values()].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).map((p,index)=>({ rank:index+1,id:p.id,name:p.name,score:p.score,pointsThisRound:p.pointsThisRound||0 }))
  };
  emitToRoom(room, 'question:ended', room.lastResult);
  broadcastRoom(room);
}
function startQuestion(room, index) {
  clearTimeout(room.timer);
  if (index >= room.quiz.questions.length) {
    room.state = 'finished'; room.current = room.quiz.questions.length - 1; room.questionEndsAt = null;
    emitToRoom(room, 'game:finished', { leaderboard:[...room.players.values()].sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).map((p,i)=>({rank:i+1,name:p.name,score:p.score})) });
    broadcastRoom(room); return;
  }
  room.current=index; room.state='question'; room.questionDuration=room.settings.timePerQuestion*1000; room.questionEndsAt=Date.now()+room.questionDuration;
  room.answerCounts={A:0,B:0,C:0,D:0}; room.lastResult=null;
  for (const player of room.players.values()) { player.answered=false; player.answer=null; player.pointsThisRound=0; }
  emitToRoom(room,'question:started',publicQuestion(room)); broadcastRoom(room);
  room.timer=setTimeout(()=>endQuestion(room),room.questionDuration+50);
}
function sendCurrentState(socket, room, role, player=null) {
  if (role === 'host') socket.emit('host:ready', publicRoom(room));
  else {
    socket.emit('player:joined', { player:safePlayer(player), room:publicRoom(room), reconnected:true, resumed:true });
    if (room.state==='question') socket.emit('question:started', publicQuestion(room));
    else if (room.state==='results'&&room.lastResult) socket.emit('question:ended',room.lastResult);
    else if (room.state==='finished') socket.emit('game:finished',{leaderboard:[...room.players.values()].sort((a,b)=>b.score-a.score).map((p,i)=>({rank:i+1,name:p.name,score:p.score}))});
  }
}
function removeSocket(socket) {
  const membership=sockets.get(socket.id); if(!membership)return; sockets.delete(socket.id);
  const room=rooms.get(membership.pin); if(!room)return;
  if(membership.role==='host') {
    if(room.hostSocket===socket.id){room.hostSocket=null;room.hostDisconnectedAt=Date.now();}
    broadcastRoom(room); return;
  }
  const player=room.players.get(membership.playerId);
  if(player&&player.socketId===socket.id){player.socketId=null;player.disconnectedAt=Date.now();broadcastRoom(room);}
}

app.post('/api/rooms', upload.single('quiz'), async (req,res)=>{
  try {
    if(!req.file)return res.status(400).json({error:'Upload a CSV file.'});
    const quiz=parseQuizCsv(req.file.buffer.toString('utf8')); validateQuiz(quiz); const pin=makePin(); const hostSessionId=token();
    const room={pin,quiz,state:'lobby',current:-1,questionEndsAt:null,questionDuration:0,answerCounts:{A:0,B:0,C:0,D:0},lastResult:null,players:new Map(),hostSocket:null,hostSessionId,hostDisconnectedAt:null,timer:null,settings:{timePerQuestion:Math.max(5,Math.min(120,Number(req.body?.timePerQuestion||20)))},createdAt:Date.now()};
    rooms.set(pin,room); res.json({pin,title:quiz.title,questionCount:quiz.questions.length,hostSessionId});
  } catch(error){res.status(400).json({error:error.message});}
});
app.get('/api/rooms/:pin',(req,res)=>{const room=rooms.get(req.params.pin);if(!room)return res.status(404).json({error:'Game not found.'});res.json({pin:room.pin,title:room.quiz.title,state:room.state,players:room.players.size});});
app.get('/api/rooms/:pin/qr',async(req,res)=>{const room=rooms.get(req.params.pin);if(!room)return res.status(404).end();const joinUrl=`${req.protocol}://${req.get('host')}/join.html?pin=${room.pin}`;res.type('png').send(await QRCode.toBuffer(joinUrl,{width:500,margin:2}));});

io.on('connection',socket=>{
  socket.on('host:claim',({pin,sessionId})=>{
    const room=rooms.get(String(pin||'')); if(!room)return socket.emit('error:message','Game not found.');
    if(sessionId!==room.hostSessionId)return socket.emit('error:message','Host session is invalid or expired.');
    if(room.hostSocket&&room.hostSocket!==socket.id)return socket.emit('error:message','This game already has a host.');
    room.hostSocket=socket.id;room.hostDisconnectedAt=null;sockets.set(socket.id,{pin:room.pin,role:'host'});sendCurrentState(socket,room,'host');
  });
  socket.on('player:join',({pin,name,sessionId})=>{
    const room=rooms.get(String(pin||'')); const playerName=cleanName(name);
    if(!room)return socket.emit('error:message','Game not found.'); if(room.state==='finished')return socket.emit('error:message','This game has finished.');
    let existing=null;
    if(sessionId) existing=[...room.players.values()].find(p=>p.sessionId===sessionId);
    if(existing){
      if(existing.socketId&&existing.socketId!==socket.id)return socket.emit('error:message','That player session is already connected.');
      existing.socketId=socket.id;existing.disconnectedAt=null;sockets.set(socket.id,{pin:room.pin,role:'player',playerId:existing.id});sendCurrentState(socket,room,'player',existing);broadcastRoom(room);return;
    }
    if(!playerName)return socket.emit('error:message','Enter a nickname.');
    const sameName=[...room.players.values()].find(p=>p.name.toLowerCase()===playerName.toLowerCase());
    if(sameName)return socket.emit('error:message',sameName.socketId?'That nickname is already in use.':'That nickname belongs to a recent session. Reopen this game on the same device to restore it.');
    const player={id:crypto.randomUUID(),sessionId:token(),socketId:socket.id,name:playerName,score:0,answered:false,answer:null,pointsThisRound:0,disconnectedAt:null};
    room.players.set(player.id,player);sockets.set(socket.id,{pin:room.pin,role:'player',playerId:player.id});
    socket.emit('player:joined',{player:safePlayer(player),room:publicRoom(room),reconnected:false,resumed:false,sessionId:player.sessionId});
    if(room.state==='question')socket.emit('question:started',publicQuestion(room));else if(room.state==='results'&&room.lastResult)socket.emit('question:ended',room.lastResult);broadcastRoom(room);
  });
  socket.on('host:start',()=>{const room=getRoomForSocket(socket);if(!room||sockets.get(socket.id)?.role!=='host')return;if(!room.players.size)return socket.emit('error:message','At least one player must join.');startQuestion(room,0);});
  socket.on('host:next',()=>{const room=getRoomForSocket(socket);if(!room||sockets.get(socket.id)?.role!=='host')return;if(room.state==='question')endQuestion(room);else if(room.state==='results')startQuestion(room,room.current+1);});
  socket.on('host:end-question',()=>{const room=getRoomForSocket(socket);if(!room||sockets.get(socket.id)?.role!=='host')return;endQuestion(room);});
  socket.on('player:answer',({answer})=>{const membership=sockets.get(socket.id);const room=membership&&rooms.get(membership.pin);if(!room||membership.role!=='player'||room.state!=='question')return;const player=room.players.get(membership.playerId);if(!player||player.answered||!['A','B','C','D'].includes(answer))return;if(Date.now()>room.questionEndsAt)return endQuestion(room);player.answered=true;player.answer=answer;room.answerCounts[answer]++;socket.emit('answer:accepted',{answer});if(room.hostSocket)io.to(room.hostSocket).emit('answer:count',{answered:[...room.players.values()].filter(p=>p.answered).length,total:room.players.size});if([...room.players.values()].filter(p=>p.socketId).every(p=>p.answered))endQuestion(room);});
  socket.on('disconnect',()=>removeSocket(socket));
});

setInterval(()=>{
  const now=Date.now();
  for(const [pin,room] of rooms){
    for(const [id,player] of room.players){if(player.disconnectedAt&&now-player.disconnectedAt>SESSION_TTL_MS)room.players.delete(id);}
    if(room.hostDisconnectedAt&&now-room.hostDisconnectedAt>SESSION_TTL_MS){clearTimeout(room.timer);emitToRoom(room,'game:closed',{reason:'The host session expired.'});rooms.delete(pin);continue;}
    if(!room.hostSocket&&room.state==='lobby'&&now-room.createdAt>SESSION_TTL_MS){rooms.delete(pin);}
  }
},15*1000);

server.listen(PORT,()=>console.log(`Notebook Live Quiz running on http://localhost:${PORT}`));
