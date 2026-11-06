import { DAY_LENGTH } from './clock.js';
import { CHUNK_SIZE } from './generation.js';
import { HEIGHT } from './world.js';

const PROTOCOL = 2;
export class MultiplayerClient {
  ready = false;
  selfId = null;
  revision = 0;
  pending = new Map();
  requestId = 0;
  retryDelay = 1000;
  callbacks = {};
  clock = { phase: 0.18, held: false, running: false };
  clockReceived = 0;
  poseElapsed = 0;

  constructor(world) { this.world = world; }

  connect(name = this.name || 'Builder') {
    clearTimeout(this.retry);
    this.name = name;
    this.stopped = false;
    this.blocked = false;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/multiplayer`);
    this.socket = socket;
    this.callbacks.status?.('Connecting to the shared world…');
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, name: this.name })));
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      try { this.receive(JSON.parse(event.data)); } catch { socket.close(1002, 'Please reconnect'); }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket || this.stopped) return;
      this.ready = false;
      for (const { resolve, timer } of this.pending.values()) { clearTimeout(timer); resolve({ ok: false, reason: 'disconnected' }); }
      this.pending.clear();
      this.callbacks.disconnected?.();
      if (this.blocked) return;
      this.callbacks.status?.('Host disconnected · reconnecting…');
      this.retry = setTimeout(() => this.connect(this.name), this.retryDelay);
      this.retryDelay = Math.min(5000, this.retryDelay * 1.5);
    });
    socket.addEventListener('error', () => {});
  }

  syncClock(clock) {
    this.clock = clock;
    this.clockReceived = performance.now();
    this.callbacks.clock?.(clock);
  }

  phase() {
    return (this.clock.phase + (!this.clock.held && this.clock.running ? (performance.now() - this.clockReceived) / 1000 / DAY_LENGTH : 0)) % 1;
  }

  receive(message) {
    if (message.type === 'unavailable') {
      this.blocked = true;
      this.callbacks.status?.(message.reason === 'storage' ? 'The host cannot save the world. Ask the host to check its disk before rejoining.'
        : message.reason === 'full' ? 'This world is full (8 players). Try again when a space opens.' : 'The host updated. Reload this page to join.');
      return;
    }
    if (message.type === 'welcome') {
      if (message.protocol !== PROTOCOL) throw new Error('Version mismatch');
      if (message.world.chunkSize !== CHUNK_SIZE || message.world.height !== HEIGHT) throw new Error('World format mismatch');
      this.world.configure(message.world);
      this.selfId = message.self.id;
      this.name = message.self.name;
      this.revision = message.revision;
      this.syncClock(message.clock);
      this.ready = true;
      this.retryDelay = 1000;
      this.callbacks.welcome?.(message);
      this.callbacks.players?.(message.players);
      return;
    }
    if (!this.ready) return;
    if (message.type === 'chunk') {
      const raw = atob(message.blocks);
      if (raw.length !== CHUNK_SIZE * CHUNK_SIZE * HEIGHT) throw new Error('Invalid chunk');
      const chunk = this.world.putChunk(message.cx, message.cz, Uint8Array.from(raw, character => character.charCodeAt(0)), message.revision);
      this.callbacks.chunks?.([chunk.key]);
    } else if (message.type === 'unload') {
      for (const key of message.keys) this.world.chunks.delete(key);
      this.callbacks.chunks?.(message.keys);
    } else if (message.type === 'players') {
      this.syncClock(message.clock);
      this.callbacks.players?.(message.players);
    } else if (message.type === 'clock') this.syncClock(message.clock);
    else if (message.type === 'edit') {
      const changes = message.updates.filter(update => this.world.chunks.has(update.key)).flatMap(update => update.changes);
      if (!this.world.applyUpdates(message.updates)) {
        this.ready = false;
        this.socket.close(1002, 'Resynchronizing chunks');
        return;
      }
      this.revision = message.revision;
      if (changes.length) this.callbacks.edit?.({ ...message, changes });
    } else if (message.type === 'result') this.resolve(message.requestId, { ok: message.ok, reason: message.reason });
  }

  disconnect() {
    this.stopped = true; this.ready = false;
    clearTimeout(this.retry);
    const socket = this.socket; this.socket = null;
    socket?.close();
    for (const { resolve, timer } of this.pending.values()) { clearTimeout(timer); resolve({ ok: false, reason: 'disconnected' }); }
    this.pending.clear();
  }

  resolve(requestId, result) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(result);
  }

  sendPose() {
    if (!this.ready || this.socket.readyState !== WebSocket.OPEN || !this.pose) return;
    this.socket.send(JSON.stringify({ type: 'pose', pose: this.pose() }));
  }

  update(seconds) {
    this.poseElapsed += seconds;
    if (this.poseElapsed >= 0.05) { this.poseElapsed = 0; this.sendPose(); }
  }

  request(method, args = {}) {
    if (!this.ready || this.socket.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, reason: 'disconnected' });
    if (this.pending.size >= 8) return Promise.resolve({ ok: false, reason: 'busy' });
    const requestId = ++this.requestId;
    const message = { type: 'command', method, requestId, ...args };
    if (Number.isInteger(args.x)) message.expected = [-1, 0, 1, 2].map(offset => this.world.get(args.x, args.y + offset, args.z));
    this.sendPose();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.resolve(requestId, { ok: false, reason: 'disconnected' });
        this.socket.close(1000, 'Reconnecting');
      }, 5000);
      this.pending.set(requestId, { resolve, timer });
      this.socket.send(JSON.stringify(message));
    });
  }

  edit(x, y, z, block) { return this.request('edit', { x, y, z, block }); }
  placeDoor(x, y, z, facing) { return this.request('placeDoor', { x, y, z, facing }); }
  placeLantern(x, y, z) { return this.request('placeLantern', { x, y, z }); }
  placeFlower(x, y, z, block) { return this.request('placeFlower', { x, y, z, block }); }
  toggleDoor(x, y, z) { return this.request('toggleDoor', { x, y, z }); }
  undo() { return this.request('undo'); }
  redo() { return this.request('redo'); }
}
