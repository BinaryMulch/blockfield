import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';
import { GameRoom, PROTOCOL } from './server/room.js';
import { CHUNK_SIZE, nearbyChunks, chunkKey } from './src/generation.js';
import { DiskWorldStore } from './server/disk-saves.js';
import { ServerMetrics } from './server/metrics.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function lanURLs(port, interfaces = networkInterfaces()) {
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
    .filter(entry => !entry.internal && entry.family === 'IPv4')
    .map(entry => ({ name, address: entry.address })));
  const ethernet = addresses.filter(entry => /^en\d|^eth\d|^wlan\d|^wi-?fi/i.test(entry.name));
  return [...new Set((ethernet.length ? ethernet : addresses).map(entry => `http://${entry.address}:${port}/`))];
}

export async function createGameServer({ host = '0.0.0.0', port = 6200, dev = false, room = null, saveDirectory = null } = {}) {
  const persistence = saveDirectory ? new DiskWorldStore(saveDirectory) : null;
  try {
    if (persistence) {
      await persistence.lock();
      const saved = await persistence.load();
      if (saved) room = GameRoom.fromSave(saved);
      if (persistence.recovered) console.warn('Recovered the world from world.json.bak. The backup was preserved.');
    }
    room ||= new GameRoom();
    if (persistence) await persistence.save(room.toSave());
  } catch (error) { await persistence?.close(); throw error; }
  let vite;
  let closing = false;
  let saving = false;
  let saveFailure = null;
  let commandQueue = Promise.resolve();
  const metrics = new ServerMetrics();
  const peers = new Map();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/performance') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ version: 1, ...metrics.snapshot(), players: room.players.size,
          loadedChunks: room.world.chunks?.size || 0, saving: !!persistence, saveHealthy: !saveFailure, mode: dev ? 'development' : 'production' }));
        return;
      }
      if (url.pathname === '/healthz') {
        response.writeHead(saveFailure ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ ok: !saveFailure, players: room.players.size, loadedChunks: room.world.chunks?.size || 0, saving: !!persistence, savedAt: persistence?.savedAt || null }));
        return;
      }
      if (url.pathname === '/api/session') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ urls: lanURLs(server.address().port), maxPlayers: room.maxPlayers, name: room.name, world: room.metadata(), protocol: PROTOCOL, gameMode: room.gameMode }));
        return;
      }
      if (vite) { vite.middlewares(request, response); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const directory = path.join(ROOT, 'dist');
      const filename = path.resolve(directory, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!filename.startsWith(directory + path.sep) || !(await stat(filename)).isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream',
        'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(filename));
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end('Not found');
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  const send = (socket, message) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1024 * 1024) { socket.close(1013, 'Connection too slow'); return; }
    socket.send(JSON.stringify(message));
  };
  const broadcast = message => { for (const [socket, peer] of peers) if (peer.id) send(socket, message); };
  const playerState = () => ({ type: 'players', players: room.playerList(), clock: room.clockState() });
  const failedSave = error => {
    saveFailure = error;
    console.error(`World saving failed; further edits are stopped to protect the last good save: ${error.message}`);
    for (const socket of peers.keys()) { send(socket, { type: 'unavailable', reason: 'storage' }); socket.close(1011, 'Host cannot save'); }
  };
  const checkpoint = async () => {
    if (persistence && !saveFailure) {
      const started = performance.now();
      try { await persistence.save(room.toSave()); } finally { metrics.saves.add(performance.now() - started); }
    }
  };
  const enqueue = task => {
    commandQueue = commandQueue.then(async () => {
      if (saveFailure) return;
      saving = true;
      try { await task(); } catch (error) { failedSave(error); } finally { saving = false; }
    });
  };
  const streamPeer = (socket, peer, limit = 4) => {
    const player = room.players.get(peer.id);
    if (!player) return;
    const { x, z } = player.pose;
    const removed = [];
    for (const key of peer.sent.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - Math.floor(x / CHUNK_SIZE)) > 5 || Math.abs(cz - Math.floor(z / CHUNK_SIZE)) > 5) { peer.sent.delete(key); removed.push(key); }
    }
    if (removed.length) send(socket, { type: 'unload', keys: removed });
    const wanted = nearbyChunks(x, z, 4, room.metadata().size).filter(chunk => !peer.sent.has(chunk.key)).slice(0, limit);
    for (const chunk of wanted) {
      const message = room.chunkSnapshot(chunk.cx, chunk.cz);
      send(socket, message); peer.sent.set(chunk.key, message.revision);
    }
  };

  server.on('upgrade', (request, socket, head) => {
    let validOrigin = true;
    try { if (request.headers.origin) validOrigin = new URL(request.headers.origin).host === request.headers.host; } catch { validOrigin = false; }
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (pathname !== '/multiplayer') {
      if (!dev) socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!validOrigin || closing) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  wss.on('connection', socket => {
    if (saveFailure) { send(socket, { type: 'unavailable', reason: 'storage' }); socket.close(1011, 'Host cannot save'); return; }
    const peer = { id: null, alive: true, count: 0, window: performance.now(), lastRequest: 0, sent: new Map() };
    peers.set(socket, peer);
    const greeting = setTimeout(() => socket.close(1008, 'Join timed out'), 5000);
    socket.on('pong', () => { peer.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (raw, binary) => {
      if (binary || closing) { socket.close(1003, 'Text messages required'); return; }
      const now = performance.now();
      if (now - peer.window > 1000) { peer.window = now; peer.count = 0; }
      if (++peer.count > 100) { socket.close(1008, 'Too many messages'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1007, 'Invalid message'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { socket.close(1007, 'Invalid message'); return; }
      if (!peer.id) {
        if (peer.joining) return;
        if (message.type !== 'hello' || message.protocol !== PROTOCOL) { send(socket, { type: 'unavailable', reason: 'version' }); socket.close(1008, 'Refresh to update'); return; }
        peer.joining = true;
        enqueue(async () => {
          if (socket.readyState !== WebSocket.OPEN || closing) return;
          const player = room.join(message.name, message.playerToken);
          if (!player) { send(socket, { type: 'unavailable', reason: room.players.size >= room.maxPlayers ? 'full' : 'profile' }); socket.close(1008, 'Cannot join this player profile'); return; }
          peer.id = player.id;
          clearTimeout(greeting);
          if (player.inventory) await checkpoint();
          send(socket, { ...room.snapshot(player), urls: lanURLs(server.address().port), persistence: !!persistence });
          streamPeer(socket, peer, 9);
          broadcast(playerState());
        });
        return;
      }
      if (message.type === 'pose') { room.move(peer.id, message.pose); return; }
      if (message.type !== 'command' || !Number.isSafeInteger(message.requestId) || message.requestId < 1) return;
      if (message.requestId <= peer.lastRequest) return;
      peer.lastRequest = message.requestId;
      enqueue(async () => {
      const result = room.command(peer.id, message);
      if (result.ok && (result.changes || result.type === 'clock' || result.type === 'supplies' || result.type === 'drops')) await checkpoint();
      if (result.ok && room.players.get(peer.id)?.inventory) send(socket, { type: 'supplies', inventory: room.players.get(peer.id).inventory.snapshot() });
      if (result.ok && result.type === 'drops') broadcast({ type: 'drops', drops: room.drops.snapshot() });
      if (result.ok && result.changes) {
        const groups = new Map();
        for (const c of result.changes) {
          const key = chunkKey(Math.floor(c.x / CHUNK_SIZE), Math.floor(c.z / CHUNK_SIZE));
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(c);
        }
        for (const [other, target] of peers) {
          if (!target.id) continue;
          const updates = [];
          for (const [key, changes] of groups) {
            if (!target.sent.has(key)) continue;
            const revision = room.chunkRevisions.get(key);
            if (target.sent.get(key) !== revision - 1) {
              const [cx, cz] = key.split(',').map(Number);
              send(other, room.chunkSnapshot(cx, cz));
            } else updates.push({ key, previousRevision: revision - 1, revision, changes });
            target.sent.set(key, revision);
          }
          if (updates.length) send(other, { type: 'edit', by: peer.id, method: message.method, updates, revision: room.revision });
        }
        send(socket, { type: 'result', requestId: message.requestId, ok: true });
      } else {
        if (result.ok && result.type === 'clock') broadcast({ type: 'clock', clock: room.clockState() });
        if (result.ok && result.type === 'players') broadcast(playerState());
        send(socket, { type: 'result', requestId: message.requestId, ok: result.ok, reason: result.reason, moved: result.moved, swapped: result.swapped });
      }
      });
    });
    socket.on('close', () => {
      clearTimeout(greeting);
      peers.delete(socket);
      if (peer.id && room.leave(peer.id) && !closing) broadcast(playerState());
    });
  });

  try {
    if (dev) {
      const { createServer } = await import('vite');
      vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } catch (error) {
    metrics.close();
    await vite?.close();
    wss.close();
    await persistence?.close();
    throw error;
  }
  let lastTick = performance.now();
  const tick = setInterval(() => {
    const now = performance.now();
    if (saving || saveFailure) { lastTick = now; return; }
    room.advance(Math.min((now - lastTick) / 1000, 1));
    lastTick = now;
    if (room.players.size) broadcast(playerState());
    for (const [socket, peer] of peers) if (peer.id) streamPeer(socket, peer);
    room.world.evict?.([...room.players.values()].map(player => player.pose), 5);
    metrics.tick.add(performance.now() - now);
  }, 100);
  const autosave = setInterval(() => {
    if (persistence && !closing && !saveFailure && room.clockState().running && !room.clock.held) enqueue(checkpoint);
  }, 5000);
  const heartbeat = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive) { socket.terminate(); continue; }
      peer.alive = false;
      socket.ping();
    }
  }, 10000);
  return {
    server, room, persistence,
    get urls() { return lanURLs(server.address().port); },
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(tick); clearInterval(heartbeat); clearInterval(autosave);
      metrics.close();
      await commandQueue;
      let failure;
      try { if (!saveFailure) await checkpoint(); } catch (error) { failure = error; }
      for (const socket of peers.keys()) socket.terminate();
      await new Promise(resolve => wss.close(resolve));
      await vite?.close();
      await new Promise(resolve => server.close(resolve));
      await persistence?.close();
      if (failure) throw failure;
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 6200);
    const game = await createGameServer({ port, host: process.env.HOST || '0.0.0.0', dev: !process.argv.includes('--production'), saveDirectory: process.env.DATA_DIR || path.join(ROOT, 'data') });
    const local = `http://localhost:${game.server.address().port}/`;
    console.log(`\nBlockfield is hosting a shared world for up to ${game.room.maxPlayers} players.\nOpen locally: ${local}`);
    for (const url of game.urls) console.log(`Join from another computer: ${url}?join=1`);
    console.log('Keep this Terminal window open. Control+C stops the world.\n');
    console.log(`World saves: ${game.persistence.filename}\n`);
    if (process.argv.includes('--open')) spawn('open', [local], { stdio: 'ignore' }).on('error', () => {});
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
      try { await game.close(); process.exit(0); } catch (error) { console.error(`Could not finish saving: ${error.message}`); process.exit(1); }
    });
  } catch (error) {
    let existing = null;
    const local = `http://localhost:${Number(process.env.PORT || 6200)}/`;
    if (['EADDRINUSE', 'EWORLDLOCKED'].includes(error.code) && process.argv.includes('--open')) {
      try {
        const response = await fetch(new URL('/api/session', local), { signal: AbortSignal.timeout(1500) });
        if (response.ok) existing = await response.json();
      } catch { /* The port may belong to a different application. */ }
    }
    if (existing?.maxPlayers === 8 && Array.isArray(existing.urls)) {
      console.log(`Blockfield is already hosting. Opening ${local}`);
      spawn('open', [local], { stdio: 'ignore' }).on('error', () => {});
    } else {
      console.error(error.code === 'EADDRINUSE' ? `Blockfield is already running on this port. Open ${local}, or stop the existing host first.` : error.message);
      process.exitCode = 1;
    }
  }
}
