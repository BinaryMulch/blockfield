import { MultiplayerClient } from './multiplayer.js';
import { EditHistory } from './history.js';
import { DayClock } from './clock.js';
import { WorldJobs } from './jobs.js';
import { nearbyChunks, WORLD_SIZE, terrainColumn } from './generation.js';
import { captureSave, restoreEdits, newWorldId, migrateSave } from './saves.js';
import { browserSaves, saveMessage } from './browser-saves.js';
import { Inventory, emptyGatherInventory } from './inventory.js';
import { ItemDrops } from './drops.js';
import { GAME_MODE, RESTRICTED_COMMANDS, buildStarterCabin } from './horror.js';
import { ShelterSystem } from './shelter.js';
import { Infrastructure } from './infrastructure.js';
import { UpkeepSystem } from './upkeep.js';
import { ListenerSystem } from './listener.js';
import { EncounterSystem, recoveryPoint } from './encounters.js';
import { ListenerPressure } from './listener-pressure.js';
const motionStamp = (pose, clock) => [pose.x, pose.y, pose.z, pose.yaw % (Math.PI * 2), pose.pitch, clock.phase, clock.elapsedSeconds].join(':');

export function serverURL(value, current = location.origin, port) {
  const base = new URL(current);
  let text = value.trim() || current;
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(text);
  // IPv6 literals need brackets in URLs, but players can type the bare address.
  if (!hasProtocol && !text.startsWith('[') && (text.match(/:/g) || []).length > 1) text = `[${text}]`;
  let url;
  try { url = new URL(hasProtocol ? text : `${base.protocol}//${text}`); }
  catch { throw new Error('Enter a valid IP address or hostname.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter a valid IP address or hostname.');
  if (port !== undefined) {
    const number = String(port).trim();
    if (!/^\d+$/.test(number) || Number(number) < 1 || Number(number) > 65535) throw new Error('Enter a port number from 1 to 65535.');
    url.port = String(Number(number));
  }
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
    if (saved) saved = migrateSave(saved);
    this.name = name || 'Builder'; this.selfId = 'single-player';
    this.world.configure(saved?.world || { seed, size: WORLD_SIZE }, true);
    this.id = saved?.id || newWorldId(); this.title = saved?.name || title || 'My world'; this.createdAt = saved?.createdAt || Date.now();
    this.saveRevision = saved?.saveRevision || 0;
    this.gameMode = GAME_MODE;
    this.resources = new Inventory(saved?.inventory || emptyGatherInventory());
    this.drops = new ItemDrops(saved?.drops);
    this.initialInventory = this.resources?.snapshot() || saved?.inventory || null;
    if (saved) restoreEdits(this.world, saved);
    else {
      // Initialize only the small starter area synchronously; subsequent
      // generation still uses workers and replays these retained edits.
      this.world.autoGenerate = true;
      this.horror = buildStarterCabin(this.world);
      this.world.autoGenerate = false;
    }
    this.horror = saved?.horror || this.horror;
    this.clock = new DayClock(saved?.clock); this.clock.running = false;
    this.infrastructure = new Infrastructure(this.world, saved?.containers, saved?.construction);
    this.upkeep = new UpkeepSystem(this.world, { saved: saved?.upkeep, clock: () => this.clock.elapsedSeconds, infrastructure: this.infrastructure, sites: this.horror.salvage });
    this.shelters = new ShelterSystem(this.world, { wardPower: p => this.upkeep.wardPower(p) });
    this.encounterEvents = [];
    this.encounters = new EncounterSystem(this.world, { saved: saved?.encounters, clock: () => this.clock.elapsedSeconds, recover: () => this.recoverPosition() });
    const pressure = new ListenerPressure(this.world, { shelters: this.shelters, infrastructure: this.infrastructure, upkeep: this.upkeep, canHit: () => this.listener.director.permissions(this.clock.elapsedSeconds).breach, onHit: () => this.listener.director.spend('hit', this.clock.elapsedSeconds, this.listener.mind.focusKey), onResult: result => this.encounterEvents.push(result) });
    this.listener = new ListenerSystem(this.world, { saved: saved?.listener, clock: () => this.clock, shelters: this.shelters, pressure,
      contact: () => this.encounters.knockDown(this.encounterPlayer(), [this.encounterPlayer()]) });
    this.upkeep.creature = this.listener;
    this.history = new EditHistory(this.world);
    this.history.creature = this.listener;
    this.history.upkeep = this.upkeep;
    this.history.infrastructure = this.infrastructure;
    this.history.inventory = this.resources;
    this.history.drops = this.drops;
    const x = WORLD_SIZE / 2, z = WORLD_SIZE / 2;
    const y = terrainColumn(this.world.seed, x, z).top + 1.01;
    const cabin = this.horror.cabin;
    this.self = { id: this.selfId, name: this.name, x: x + 0.5, y, z: z + 0.5,
      yaw: cabin ? Math.atan2(x - cabin.x - 3, z - cabin.z - 3) : 0, pitch: -0.12, color: '#db8b58', ...saved?.player, flying: false };
    const encounter = this.encounters.record({ id: this.selfId });
    if (encounter?.state === 'downed') Object.assign(this.self, encounter.position);
    this.self.encounter = this.encounters.publicState({ id: this.selfId });
    this.starting = true;
    const committed = await this.save();
    if (!committed || this.closed) throw new Error(this.saveError || 'The world could not be saved.');
    this.starting = false; this.ready = true; this.clock.running = true;
    this.callbacks.welcome?.({ self: this.self, world: this.world.metadata(), worldName: this.title, worldId: this.id, inventory: this.initialInventory,
      gameMode: this.gameMode, horror: this.horror, players: [this.self], maxPlayers: 1, urls: [], saved: true });
    for (const chunk of this.world.chunks.values()) this.callbacks.constructionChunk?.({ key: chunk.key, damage: this.infrastructure.chunkDamage(chunk.cx, chunk.cz) });
    this.callbacks.clock?.(this.clock);
    this.callbacks.players?.([this.self]);
    this.callbacks.listener?.(this.listener.publicState());
    this.callbacks.drops?.(this.drops.publicSnapshot());
    this.publishShelter();
  }

  snapshot() {
    let inventory = this.starting ? this.initialInventory : this.inventory?.();
    if (this.resources && !this.starting) inventory = { ...this.resources.snapshot(), selected: inventory?.selected ?? this.resources.selected };
    return captureSave({ world: this.world, id: this.id, name: this.title, createdAt: this.createdAt, clock: this.clock,
      player: this.encounters?.downed({ id: this.selfId }) ? { ...(this.pose?.() || this.self), ...this.encounters.record({ id: this.selfId }).position } : this.starting ? this.self : this.pose?.() || this.self, gameMode: this.gameMode,
      inventory, horror: this.horror, listener: this.listener?.snapshot(), encounters: this.encounters?.snapshot(), upkeep: this.upkeep?.snapshot(), ...this.infrastructure?.snapshot(), drops: this.drops.snapshot() });
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

  publishShelter() {
    if (!this.shelters || this.closed) return;
    const shelter = this.shelters.snapshot(this.pose?.() || this.self), stamp = JSON.stringify(shelter);
    if (stamp !== this.lastShelter) { this.lastShelter = stamp; this.callbacks.shelter?.(shelter); }
  }

  async generate(cx, cz) {
    const { blocks } = await this.jobs.call({ kind: 'generate', cx, cz, seed: this.world.seed, size: this.world.size });
    if (this.closed) return;
    const chunk = this.world.putChunk(cx, cz, blocks, this.world.revisions.get(`${cx},${cz}`) || 0);
    this.callbacks.constructionChunk?.({ key: chunk.key, damage: this.infrastructure.chunkDamage(cx, cz) });
    this.callbacks.chunks?.([chunk.key]);
    this.publishShelter();
  }

  update(seconds) {
    if (!this.ready || this.closed) return;
    const pose = this.pose?.() || this.self;
    // A command checkpoint already suspends AI mutations. Suspend the same
    // occupied clock too, as the shared host does, rather than letting slow
    // storage consume evidence, pursuit warnings, or recovery time unseen.
    this.clock.running = !this.saveError && !this.encounterSaving && !this.editing;
    if (this.clock.running) {
      this.clock.advance(seconds); this.saveElapsed += seconds;
      this.drops.settle(this.world);
      if (this.drops.dirty) { this.callbacks.drops?.(this.drops.publicSnapshot()); this.drops.dirty = false; }
    }
    if (this.clock.running && this.saveElapsed >= 5 && motionStamp(pose, this.clock) !== this.savedMotion) { this.saveElapsed = 0; void this.save(); }
    const removed = this.world.evict([pose], 5);
    if (removed.length) this.callbacks.chunks?.(removed);
    for (const chunk of nearbyChunks(pose.x, pose.z, 4, this.world.size)) {
      if (this.generating.size >= 2) break;
      if (this.world.chunks.has(chunk.key) || this.generating.has(chunk.key)) continue;
      this.generating.add(chunk.key);
      this.generate(chunk.cx, chunk.cz).catch(error => { if (!this.closed) this.callbacks.status?.(error.message); }).finally(() => this.generating.delete(chunk.key));
    }
    if (this.clock.running && !this.editing && this.upkeep?.hasDue()) {
      this.editing = true;
      const changes = this.upkeep.step([pose]);
      if (changes.length) {
        if (this.drops.settle(this.world)) { this.callbacks.drops?.(this.drops.publicSnapshot()); this.drops.dirty = false; }
        this.callbacks.edit?.({ changes, by: 'world', method: 'growth' }); this.publishShelter();
        void this.save().finally(() => { this.editing = false; });
      } else this.editing = false;
    }
    if (this.shelters?.advance(seconds)) this.publishShelter();
    if (this.clock.running && !this.editing) {
      const player = this.encounterPlayer();
      this.encounters.advance([player]);
      // Recovery changes the authoritative pose before sending it to the client.
      if (this.encounters.dirty) Object.assign(this.self, player.pose);
      if (this.encounters.dirty) this.callbacks.players?.([{ ...player.pose, id: this.selfId, name: this.name, encounter: this.encounters.publicState(player) }]);
      if (this.listener?.advance(seconds, [{ ...player, vulnerable: this.encounters.vulnerable(player), downed: this.encounters.downed(player) }])) this.callbacks.listener?.(this.listener.publicState());
      if (this.encounters.dirty || this.encounterEvents.length) {
        this.encounters.dirty = false;
        for (const result of this.encounterEvents.splice(0)) {
          if (result.changes) this.callbacks.edit?.({ changes: result.changes, by: 'listener', method: 'pressure' });
          if (result.damage) this.callbacks.construction?.(result.damage, { by: 'listener' });
        }
        this.callbacks.players?.([{ ...player.pose, id: this.selfId, name: this.name, encounter: this.encounters.publicState(player) }]);
        if (this.drops.settle(this.world)) { this.callbacks.drops?.(this.drops.publicSnapshot()); this.drops.dirty = false; }
        this.encounterSaving = true;
        void this.save().finally(() => { this.encounterSaving = false; });
      }
    }
  }

  recoverPosition() {
    const loaded = new Set(this.world.chunks.keys()), point = recoveryPoint(this.world, this.horror);
    const added = [...this.world.chunks.values()].filter(chunk => !loaded.has(chunk.key));
    for (const chunk of added) this.callbacks.constructionChunk?.({ key: chunk.key, damage: this.infrastructure.chunkDamage(chunk.cx, chunk.cz) });
    if (added.length) this.callbacks.chunks?.(added.map(chunk => chunk.key));
    return point;
  }

  encounterPlayer() { return { id: this.selfId, key: this.selfId, pose: { ...(this.pose?.() || this.self) } }; }

  async request(method, args = {}) {
    const result = await this.performRequest(method, args);
    this.listener?.action(this.selfId, method, args, result, this.pose?.() || this.self);
    return result;
  }

  async performRequest(method, args = {}) {
    if (!this.ready || this.closed) return { ok: false, reason: 'disconnected' };
    if (method === 'save') return { ok: await this.save() };
    if (this.saveError && method !== 'name') return { ok: false, reason: 'storage' };
    if (this.encounters?.downed({ id: this.selfId }) && method !== 'name') return { ok: false, reason: 'downed' };
    if (method === 'rescue') return { ok: false, reason: 'rescue_unavailable' };
    if (RESTRICTED_COMMANDS.has(method)) return { ok: false, reason: 'restricted' };
    if (['inspectUpkeep', 'gatherSalvage', 'repair', 'refuelWard', 'setWardPower'].includes(method)) {
      if (method === 'inspectUpkeep') return this.upkeep.command(method, args, this.resources, this.pose?.() || this.self);
      if (this.editing) return { ok: false, reason: 'busy' };
      this.editing = true;
      try {
        const result = this.upkeep.command(method, args, this.resources, this.pose?.() || this.self);
        if (!result.ok) return result;
        this.callbacks.supplies?.(this.resources.snapshot()); this.callbacks.upkeep?.(result.info);
        if (result.damage) this.callbacks.construction?.(result.damage);
        this.publishShelter();
        if (!await this.save()) return { ok: false, reason: 'storage' };
        return result;
      } finally { this.editing = false; }
    }
    if (method === 'openStorage' || method === 'storage') {
      if (this.editing) return { ok: false, reason: 'busy' };
      this.editing = true;
      try {
        const result = this.infrastructure.storage(method, args, this.resources, this.pose?.() || this.self, newWorldId());
        if (result.storage) this.callbacks.storage?.(result.storage);
        if (!result.ok) return result;
        this.callbacks.supplies?.(this.resources.snapshot());
        if (!await this.save()) return { ok: false, reason: 'storage' };
        return result;
      } finally { this.editing = false; }
    }
    if (method === 'drop' || method === 'pickup') {
      if (this.editing) return { ok: false, reason: 'busy' };
      this.editing = true;
      try {
        const pose = this.pose?.() || this.self;
        const result = method === 'drop' ? this.drops.drop(this.world, this.resources, pose, args, newWorldId(), this.clock.elapsedSeconds * 1000) : this.drops.pickup(this.world, this.resources, pose, this.clock.elapsedSeconds * 1000);
        if (!result.ok) return result;
        // Like private block edits, retain unsaved work in memory if storage fails.
        // Publish both sides so retry/export shows the same inventory and world.
        this.callbacks.supplies?.(this.resources.snapshot());
        this.callbacks.drops?.(this.drops.publicSnapshot());
        if (!await this.save()) return { ok: false, reason: 'storage' };
        return result;
      } finally { this.editing = false; }
    }
    if (method === 'craft' || method === 'inventory') {
      if (this.editing) return { ok: false, reason: 'busy' };
      this.editing = true;
      try {
        const result = (method === 'craft' ? this.resources?.craft(args.block) : this.resources?.action(args)) || { ok: false, reason: 'invalid' };
        if (!result.ok) return result;
        this.callbacks.supplies?.(this.resources.snapshot());
        return { ...result, ok: await this.save(), reason: this.saveError ? 'storage' : undefined };
      } finally { this.editing = false; }
    }
    if (method === 'name') { this.name = args.name; return { ok: true }; }
    if (this.editing) return { ok: false, reason: 'busy' };
    this.editing = true;
    try {
      if (this.closed) return { ok: false, reason: 'disconnected' };
      const p = this.pose?.() || this.self;
      const { x, y, z, block, facing } = args;
      this.history.spendSlot = this.resources && ['edit', 'placeDoor', 'placeLantern', 'placeFlower'].includes(method) ? args.slot ?? -1 : undefined;
      if (this.resources && Number.isInteger(args.slot)) this.resources.select(args.slot);
      this.history.attackTime = this.clock.elapsedSeconds;
      let result;
      if (method === 'edit') result = this.history.edit(x, y, z, block, p);
      else if (method === 'placeDoor') result = this.history.placeDoor(x, y, z, facing, p, block);
      else if (method === 'placeLantern') result = this.history.placeLantern(x, y, z, p, block);
      else if (method === 'placeFlower') result = this.history.placeFlower(x, y, z, block, p);
      else if (method === 'toggleDoor') result = this.history.toggleDoor(x, y, z, p);
      else return { ok: false, reason: 'invalid' };
      if (result.ok) {
        if (this.resources) this.callbacks.supplies?.(this.resources.snapshot());
        if (result.dropsChanged) this.callbacks.drops?.(this.drops.publicSnapshot());
        if (result.changes) this.callbacks.edit?.({ changes: result.changes, by: this.selfId, method });
        if (result.damage) this.callbacks.construction?.(result.damage);
        this.publishShelter();
      }
      if (result.ok && !await this.save()) return { ok: false, reason: 'storage' };
      return result;
    } catch (error) {
      if (!this.closed) this.callbacks.status?.(error.message);
      return { ok: false, reason: this.closed ? 'disconnected' : 'invalid' };
    } finally { this.editing = false; }
  }

  disconnect() { this.closed = true; this.ready = false; if (this.clock) this.clock.running = false; this.jobs.dispose(); }
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
  request(method, args = {}) { return this.backend?.request(method, { ...args, slot: this.inventory?.().selected }) || Promise.resolve({ ok: false, reason: 'disconnected' }); }
  disconnect() { this.backend?.disconnect(); this.backend = null; this.mode = null; }

  setup(backend, mode, name) {
    this.disconnect(); this.backend = backend; this.mode = mode; this.name = name;
    backend.callbacks = this.callbacks; backend.pose = () => this.pose?.();
    backend.inventory = () => this.inventory?.();
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
  placeDoor(x, y, z, facing, block) { return this.request('placeDoor', { x, y, z, facing, block }); }
  placeLantern(x, y, z, block) { return this.request('placeLantern', { x, y, z, block }); }
  placeFlower(x, y, z, block) { return this.request('placeFlower', { x, y, z, block }); }
  toggleDoor(x, y, z) { return this.request('toggleDoor', { x, y, z }); }
  undo() { return this.request('undo'); }
  redo() { return this.request('redo'); }
}
