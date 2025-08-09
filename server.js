require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Expose selected env to client
app.get('/env.js', (_req, res) => {
  const turnUrl = process.env.TURN_URL || '';
  const turnUser = process.env.TURN_USERNAME || '';
  const turnPass = process.env.TURN_PASSWORD || '';
  res.type('application/javascript').send(
    `window.TURN_URL=${JSON.stringify(turnUrl)};\n` +
    `window.TURN_USERNAME=${JSON.stringify(turnUser)};\n` +
    `window.TURN_PASSWORD=${JSON.stringify(turnPass)};\n`
  );
});

const server = http.createServer(app);

// Simple in-memory rooms
// roomId -> Set of ws
const rooms = new Map();

function getPeers(roomId) {
  return rooms.get(roomId) || new Set();
}

function broadcast(roomId, data, except) {
  const peers = getPeers(roomId);
  for (const peer of peers) {
    if (peer !== except && peer.readyState === 1) {
      peer.send(JSON.stringify(data));
    }
  }
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.clientId = Math.random().toString(36).slice(2, 10);

  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      return;
    }
    const { type, roomId, payload } = msg;

    if (type === 'join') {
      ws.roomId = roomId;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      rooms.get(roomId).add(ws);
      // notify others
      broadcast(roomId, { type: 'peer-joined', clientId: ws.clientId }, ws);
      // reply self with peers list
      const peers = Array.from(getPeers(roomId))
        .filter((p) => p !== ws)
        .map((p) => p.clientId);
      ws.send(JSON.stringify({ type: 'peers', peers }));
      return;
    }

    if (!ws.roomId) return;

    // signaling relay
    if (type === 'signal') {
      const { targetId, data } = payload || {};
      const peers = getPeers(ws.roomId);
      for (const peer of peers) {
        if (peer.clientId === targetId && peer.readyState === 1) {
          peer.send(
            JSON.stringify({
              type: 'signal',
              from: ws.clientId,
              data,
            })
          );
          break;
        }
      }
      return;
    }

    if (type === 'leave') {
      cleanup(ws);
      return;
    }
  });

  ws.on('close', () => cleanup(ws));
});

function cleanup(ws) {
  const { roomId } = ws;
  if (!roomId) return;
  const peers = rooms.get(roomId);
  if (peers) {
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(roomId);
    else broadcast(roomId, { type: 'peer-left', clientId: ws.clientId }, ws);
  }
  ws.roomId = null;
}

server.listen(PORT, () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});


