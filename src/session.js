import { MultiplayerClient } from './multiplayer.js';
import { EditHistory } from './history.js';
import { DayClock } from './clock.js';
import { WorldJobs } from './jobs.js';
import { nearbyChunks, WORLD_SIZE, terrainColumn, CHUNK_SIZE } from './generation.js';
import { captureSave, restoreEdits, newWorldId } from './saves.js';
import { browserSaves, saveMessage } from './browser-saves.js';
const motionStamp = (pose, clock) => [pose.x, pose.y, pose.z, pose.yaw % (Math.PI * 2), pose.pitch, pose.flying === true, clock.phase, clock.held].join(':');

export function serverURL(value, current = location.origin) {
  const text = value.trim() || current;
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) && !/^[\w.-]+:\d+(\/|$)/.test(text) ? text : `http://${text}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an http:// or https:// server address.');
  url.pathname = '/'; url.hash = ''; url.search = '?join=1';
  return url;
}

export class LocalSession extends MultiplayerClient {
  jobs = new WorldJobs();
  generating = new Set();
  closed = false;
  editing = false;
  saving = Promise.resolve();
  saveElapsed = 0;
  saveRevision = 0;

  async start(name, title, seed, saved = null) {
    this.name = name || 'Builder'; this.selfId = 'single-player';
    this.world.configure(saved?.world || { seed, size: WORLD_SIZE }, true);
    this.id = saved?.id || newWorldId(); this.title = saved?.name || title || 'My world'; this.createdAt = saved?.createdAt || Date.now();
    this.saveRevision = saved?.saveRevision || 0;
    if (saved) restoreEdits(this.world, saved);
    this.clock = new DayClock(); this.clock.running = false;
    if (saved) { this.clock.phase = saved.clock.phase; this.clock.held = saved.clock.held; }
    this.history = new EditHistory(this.world);
    const x = WORLD_SIZE / 2, z = WORLD_SIZE / 2;
    const y = terrainColumn(this.world.seed, x, z).top + 1.01;
    this.self = { id: this.selfId, name: this.name, x: x + 0.5, y, z: z + 0.5, yaw: 0, pitch: -0.12, flying: false, color: '#db8b58', ...saved?.player };
    this.starting = true;
    const committed = await this.save();
    if (!committed || this.closed) throw new Error(this.saveError || 'The world could not be saved.');
    this.starting = false; this.ready = true;
    this.callbacks.welcome?.({ self: this.self, world: this.world.metadata(), worldName: this.title, players: [this.self], maxPlayers: 1, urls: [], saved: true });
    this.callbacks.players?.([this.self]);
  }

  snapshot() {
    return captureSave({ world: this.world, id: this.id, name: this.title, createdAt: this.createdAt, clock: this.clock,
      player: this.starting ? this.self : this.pose?.() || this.self });
  }

  save() {
    if (this.closed) return Promise.resolve(false);
    this.saving = this.saving.then(async () => {
      if (this.closed) return false;
      this.callbacks.saving?.({ state: 'saving', message: 'Saving…' });
      try {
        const record = await browserSaves.save(this.snapshot(), this.saveRevision);
        this.saveRevision = record.saveRevision; this.saveError = null;
        this.savedMotion = motionStamp(record.player || this.self, record.clock); this.saveElapsed = 0;
        this.callbacks.saving?.({ state: 'saved', message: 'Saved in this browser', updatedAt: record.updatedAt });
        return true;
      } catch (error) {
        this.saveError = saveMessage(error);
        this.callbacks.saving?.({ state: 'error', message: this.saveError });
        return false;
      }
    });
    return this.saving;
  }

  phase() { return this.clock.phase; }
  sendPose() {}

  async generate(cx, cz) {
    const { blocks } = await this.jobs.call({ kind: 'generate', cx, cz, seed: this.world.seed, size: this.world.size });
    if (this.closed) return;
    const chunk = this.world.putChunk(cx, cz, blocks, this.world.revisions.get(`${cx},${cz}`) || 0);
    this.callbacks.chunks?.([chunk.key]);
  }

  update(seconds) {
    if (!this.ready || this.closed) return;
    const pose = this.pose?.() || this.self;
    this.clock.running = pose.active === true;
    if (this.clock.running) this.clock.advance(seconds);
    this.saveElapsed += seconds;
    if (this.saveElapsed >= 5 && !this.saveError && motionStamp(pose, this.clock) !== this.savedMotion) { this.saveElapsed = 0; void this.save(); }
    const removed = this.world.evict([pose], 5);
    if (removed.length) this.callbacks.chunks?.(removed);
    for (const chunk of nearbyChunks(pose.x, pose.z, 4, this.world.size)) {
      if (this.generating.size >= 2) break;
      if (this.world.chunks.has(chunk.key) || this.generating.has(chunk.key)) continue;
      this.generating.add(chunk.key);
      this.generate(chunk.cx, chunk.cz).catch(error => { if (!this.closed) this.callbacks.status?.(error.message); }).finally(() => this.generating.delete(chunk.key));
    }
  }

  async request(method, args = {}) {
    if (!this.ready || this.closed) return { ok: false, reason: 'disconnected' };
    if (method === 'save') return { ok: await this.save() };
    if (this.saveError && method !== 'name') return { ok: false, reason: 'storage' };
    if (method === 'time') {
      if (args.action === 'hold') this.clock.held = !this.clock.held;
      else if (args.action === 'next') this.clock.next();
      this.callbacks.clock?.(this.clock);
      return { ok: await this.save(), reason: this.saveError ? 'storage' : undefined };
    }
    if (method === 'name') { this.name = args.name; return { ok: true }; }
    if (this.editing) return { ok: false, reason: 'busy' };
    this.editing = true;
    try {
      const cells = method === 'undo' ? this.history.undoStack.at(-1) : method === 'redo' ? this.history.redoStack.at(-1) : null;
      if (cells) for (const cell of cells) {
        const cx = Math.floor(cell.x / CHUNK_SIZE), cz = Math.floor(cell.z / CHUNK_SIZE);
        if (!this.world.getChunk(cx, cz, false)) await this.generate(cx, cz);
      }
      if (this.closed) return { ok: false, reason: 'disconnected' };
      const p = this.pose?.() || this.self;
      const { x, y, z, block, facing } = args;
      let result;
      if (method === 'edit') result = this.history.edit(x, y, z, block, p);
      else if (method === 'placeDoor') result = this.history.placeDoor(x, y, z, facing, p);
      else if (method === 'placeLantern') result = this.history.placeLantern(x, y, z, p);
      else if (method === 'placeFlower') result = this.history.placeFlower(x, y, z, block, p);
      else if (method === 'toggleDoor') result = this.history.toggleDoor(x, y, z, p);
      else if (method === 'undo' || method === 'redo') result = this.history[method](p);
      else return { ok: false, reason: 'invalid' };
      if (result.ok) this.callbacks.edit?.({ changes: result.changes, by: this.selfId, method });
      if (result.ok && !await this.save()) return { ok: false, reason: 'storage' };
      return result;
    } catch (error) {
      if (!this.closed) this.callbacks.status?.(error.message);
      return { ok: false, reason: this.closed ? 'disconnected' : 'invalid' };
    } finally { this.editing = false; }
  }

  disconnect() { this.closed = true; this.ready = false; this.jobs.dispose(); }
}

export class GameSession {
  callbacks = {};
  name = 'Builder';
  mode = null;

  constructor(world) { this.world = world; }
  get ready() { return this.backend?.ready || false; }
  get blocked() { return this.backend?.blocked || false; }
  get selfId() { return this.backend?.selfId; }
  get clock() { return this.backend?.clock || { phase: 0.18, held: false, running: false }; }
  phase() { return this.backend?.phase() ?? 0.18; }
  update(seconds) { this.backend?.update(seconds); }
  sendPose() { this.backend?.sendPose(); }
  request(method, args) { return this.backend?.request(method, args) || Promise.resolve({ ok: false, reason: 'disconnected' }); }
  disconnect() { this.backend?.disconnect(); this.backend = null; this.mode = null; }

  setup(backend, mode, name) {
    this.disconnect(); this.backend = backend; this.mode = mode; this.name = name;
    backend.callbacks = this.callbacks; backend.pose = () => this.pose?.();
  }
  connect(name) { const backend = new MultiplayerClient(this.world); this.setup(backend, 'multiplayer', name); backend.connect(name); }
  async create(name, title, seed) {
    const backend = new LocalSession(this.world); this.setup(backend, 'single', name);
    try { await backend.start(name, title, seed); } catch (error) { backend.disconnect(); throw error; }
  }
  async resume(name, id) {
    const saved = await browserSaves.load(id), backend = new LocalSession(this.world);
    this.setup(backend, 'single', name);
    try { await backend.start(name, saved.name, saved.world.seed, saved); } catch (error) { backend.disconnect(); throw error; }
  }
  flush() { return this.mode === 'single' && this.backend?.ready ? this.backend.save() : Promise.resolve(true); }
  snapshot() { return this.mode === 'single' ? this.backend?.snapshot() : null; }
  edit(x, y, z, block) { return this.request('edit', { x, y, z, block }); }
  placeDoor(x, y, z, facing) { return this.request('placeDoor', { x, y, z, facing }); }
  placeLantern(x, y, z) { return this.request('placeLantern', { x, y, z }); }
  placeFlower(x, y, z, block) { return this.request('placeFlower', { x, y, z, block }); }
  toggleDoor(x, y, z) { return this.request('toggleDoor', { x, y, z }); }
  undo() { return this.request('undo'); }
  redo() { return this.request('redo'); }
}
