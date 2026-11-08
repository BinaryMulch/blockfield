import { randomUUID } from 'node:crypto';
import { SIZE, HEIGHT, AIR, WATER, PLANKS, EYE_HEIGHT, isBlock, isSolid, isSlab, isFlower, overlapsBlock, spawnPlayer } from '../src/world.js';
import { EditHistory } from '../src/history.js';
import { DayClock } from '../src/clock.js';
import { ChunkWorld } from '../src/chunks.js';
import { CHUNK_SIZE, chunkKey, chunkIndex } from '../src/generation.js';
import { captureSave, restoreEdits, validPlayerToken, migrateSave } from '../src/saves.js';
import { Inventory, emptyGatherInventory } from '../src/inventory.js';
import { GAME_MODE, RESTRICTED_COMMANDS, buildStarterCabin } from '../src/horror.js';
import { ItemDrops } from '../src/drops.js';
import { ShelterSystem } from '../src/shelter.js';
import { Infrastructure } from '../src/infrastructure.js';
import { UpkeepSystem } from '../src/upkeep.js';
import { ListenerSystem } from '../src/listener.js';
import { EncounterSystem, recoveryPoint } from '../src/encounters.js';
import { ListenerPressure } from '../src/listener-pressure.js';

export const PROTOCOL = 15;
export const MAX_PLAYERS = 8;
const COLORS = ['#db8b58', '#669bc1', '#b17bb2', '#79a56c', '#d2b358', '#d77587', '#69aeaa', '#8f8ac5'];
const indexOf = (x, y, z) => `${x},${y},${z}`;
export const cleanName = name => typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) || 'Builder' : 'Builder';

// Preserve cell lineage through undo/redo. Another player's break-and-replace
// must conflict even if it happens to restore the same material ID.
class SharedHistory extends EditHistory {
  stamps = new WeakMap();

  constructor(room) {
    super(room.world);
    this.room = room;
  }

  apply(cells, forward, player) {
    const { room } = this;
    const record = this.stamps.get(cells);
    if (record && cells.some((c, i) => (room.versions.get(indexOf(c.x, c.y, c.z)) || 0) !== record[forward ? 'before' : 'after'][i])) return { ok: false, reason: 'changed' };
    const changes = cells.map(c => ({ ...c, to: forward ? c.after : c.before }));
    for (const c of changes) {
      if (isSolid(c.to) && [...room.players.values()].some(other => overlapsBlock(other.pose, c.x, c.y, c.z, c.to))) return { ok: false, reason: 'blocked' };
    }
    const before = cells.map(c => room.versions.get(indexOf(c.x, c.y, c.z)) || 0);
    const result = super.apply(cells, forward, player);
    if (!result.ok || !result.changes) return result;
    room.revision++;
    const lineage = record || { before, after: cells.map(() => room.revision) };
    this.stamps.set(cells, lineage);
    cells.forEach((c, i) => {
      const key = indexOf(c.x, c.y, c.z), version = lineage[forward ? 'after' : 'before'][i];
      if (version) room.versions.set(key, version); else room.versions.delete(key);
    });
    for (const key of new Set(cells.map(c => chunkKey(Math.floor(c.x / CHUNK_SIZE), Math.floor(c.z / CHUNK_SIZE))))) room.chunkRevisions.set(key, (room.chunkRevisions.get(key) || 0) + 1);
    return result;
  }
}

export class GameRoom {
  players = new Map();
  revision = 0;
  clock = new DayClock();
  colorIndex = 0;
  drops = new ItemDrops();

  constructor({ world, maxPlayers = MAX_PLAYERS, name = process.env.WORLD_NAME || 'Blockfield Together', gameMode = GAME_MODE } = {}) {
    if (gameMode !== GAME_MODE) throw new Error('Blockfield supports Horror mode only.');
    this.gameMode = GAME_MODE;
    this.horror = world ? { version: 1, cabin: null } : null;
    world ||= new ChunkWorld({ seed: process.env.WORLD_SEED || 'Blockfield' });
    this.horror ||= buildStarterCabin(world);
    this.profiles = new Map();
    this.world = world;
    this.infrastructure = new Infrastructure(world);
    this.upkeep = new UpkeepSystem(world, { clock: () => this.clock.elapsedSeconds, infrastructure: this.infrastructure, sites: this.horror.salvage });
    this.shelters = new ShelterSystem(world, { wardPower: p => this.upkeep.wardPower(p) });
    this.setupEncounters();
    this.maxPlayers = maxPlayers;
    this.versions = new Map();
    this.chunkRevisions = new Map();
    this.name = String(name).slice(0, 40);
    this.sessionId = randomUUID();
    this.worldId = randomUUID();
    this.createdAt = Date.now();
  }

  toSave() { return captureSave({ world: this.world, id: this.worldId, name: this.name, createdAt: this.createdAt, clock: this.clock, gameMode: this.gameMode,
    horror: this.horror, listener: this.listener.snapshot(), encounters: this.encounters.snapshot(), upkeep: this.upkeep.snapshot(), ...this.infrastructure.snapshot(), profiles: [...this.profiles].map(([token, inventory]) => [token, inventory.snapshot()]), drops: this.drops.snapshot() }); }

  static fromSave(save) {
    save = migrateSave(save);
    const world = new ChunkWorld({ seed: save.world.seed, size: save.world.size });
    restoreEdits(world, save);
    const room = new GameRoom({ world, name: save.name });
    room.horror = save.horror;
    room.infrastructure = new Infrastructure(world, save.containers, save.construction);
    room.profiles = new Map((save.profiles || []).map(([token, inventory]) => [token, new Inventory(inventory)]));
    room.drops = new ItemDrops(save.drops);
    room.worldId = save.id; room.createdAt = save.createdAt;
    room.clock = new DayClock(save.clock);
    room.upkeep = new UpkeepSystem(world, { saved: save.upkeep, clock: () => room.clock.elapsedSeconds, infrastructure: room.infrastructure, sites: room.horror.salvage });
    room.setupEncounters(save);
    return room;
  }

  setupEncounters(saved = {}) {
    this.encounterEvents = [];
    this.encounters = new EncounterSystem(this.world, { clock: () => this.clock.elapsedSeconds, saved: saved.encounters, recover: player => recoveryPoint(this.world, this.horror, [...this.players.values()].filter(p => p.id !== player.id).map(p => p.pose)) });
    const pressure = new ListenerPressure(this.world, { shelters: this.shelters, infrastructure: this.infrastructure, upkeep: this.upkeep,
      canHit: () => this.listener.director.permissions(this.clock.elapsedSeconds).breach,
      onHit: () => this.listener.director.spend('hit', this.clock.elapsedSeconds, this.listener.mind.focusKey),
      onResult: result => {
        if (result.changes) this.recordWorldChanges(result.changes);
        this.encounterEvents.push(result);
      } });
    this.listener = new ListenerSystem(this.world, { saved: saved.listener, clock: () => this.clock, shelters: this.shelters, pressure,
      contact: id => { const player = this.players.get(id); return player ? this.encounters.knockDown({ ...player, key: player.token }, this.encounterPlayers()) : false; } });
    this.upkeep.creature = this.listener;
  }
  encounterPlayers() { return [...this.players.values()].map(p => ({ id: p.id, key: p.token, pose: p.pose })); }
  get encountersDirty() { return this.encounters.dirty || this.encounterEvents.length > 0; }
  drainEncounters() { const events = this.encounterEvents.splice(0); this.encounters.dirty = false; return events; }
  recordWorldChanges(changes) {
    if (!changes.length) return;
    this.revision++;
    for (const c of changes) this.versions.set(indexOf(c.x, c.y, c.z), this.revision);
    for (const k of new Set(changes.map(c => chunkKey(Math.floor(c.x / 16), Math.floor(c.z / 16))))) this.chunkRevisions.set(k, (this.chunkRevisions.get(k) || 0) + 1);
  }

  join(name, token) {
    if (this.players.size >= this.maxPlayers) return null;
    {
      token = validPlayerToken(token) ? token : randomUUID();
      if ([...this.players.values()].some(player => player.token === token)) return null;
      if (!this.profiles.has(token)) {
        if (this.profiles.size >= 10000) return null;
        this.profiles.set(token, new Inventory(emptyGatherInventory()));
      }
    }
    const id = randomUUID();
    const pose = spawnPlayer(this.world);
    const offsets = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, 2], [2, -2]];
    const base = { ...pose };
    for (const [dx, dz] of offsets) {
      pose.x = base.x + dx; pose.z = base.z + dz;
      pose.y = this.world.surface(Math.floor(pose.x), Math.floor(pose.z)) + 0.01;
      if (![...this.players.values()].some(other => Math.hypot(other.pose.x - pose.x, other.pose.z - pose.z) < 1)) break;
    }
    const cabin = this.horror.cabin;
    Object.assign(pose, { yaw: cabin ? Math.atan2(pose.x - cabin.x - 3.5, pose.z - cabin.z - 3.5) : 0, pitch: -0.12, active: false });
    const player = { id, name: cleanName(name), color: COLORS[this.colorIndex++ % COLORS.length], pose, history: new SharedHistory(this) };
    {
      player.token = token; player.inventory = this.profiles.get(token); player.history.inventory = player.inventory;
    }
    player.history.creature = this.listener;
    player.history.infrastructure = this.infrastructure; player.history.upkeep = this.upkeep; player.history.actorId = id;
    const encounter = this.encounters.record({ key: token });
    if (encounter?.state === 'downed') Object.assign(pose, encounter.position);
    this.players.set(id, player);
    return player;
  }

  publicPlayer(player) {
    return { id: player.id, name: player.name, color: player.color, ...player.pose, encounter: this.encounters.publicState({ ...player, key: player.token }) };
  }

  playerList() { return [...this.players.values()].map(player => this.publicPlayer(player)); }
  clockState() { return this.clock.snapshot(this.players.size > 0); }
  shelterSnapshot(id) { const player = this.players.get(id); return player ? this.shelters.snapshot(player.pose) : null; }

  metadata() { return this.world.metadata?.() || { size: SIZE, height: HEIGHT, chunkSize: CHUNK_SIZE, seed: 'test', generator: 0 }; }

  snapshot(player) {
    return { type: 'welcome', protocol: PROTOCOL, sessionId: this.sessionId, worldId: this.worldId, self: this.publicPlayer(player), players: this.playerList(),
      world: this.metadata(), worldName: this.name, revision: this.revision, clock: this.clockState(), shelter: this.shelterSnapshot(player.id), maxPlayers: this.maxPlayers, gameMode: this.gameMode, horror: this.horror, listener: this.listener.publicState(), drops: this.drops.snapshot(),
      ...(player.inventory ? { inventory: player.inventory.snapshot(), playerToken: player.token } : {}) };
  }

  chunkSnapshot(cx, cz) {
    const key = chunkKey(cx, cz);
    let blocks = this.world.getChunk?.(cx, cz)?.blocks;
    if (!blocks) {
      blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * HEIGHT);
      for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) blocks[chunkIndex(x, y, z)] = this.world.get(cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z);
    }
    return { type: 'chunk', cx, cz, revision: this.chunkRevisions.get(key) || 0, blocks: Buffer.from(blocks).toString('base64'), construction: this.infrastructure.chunkDamage(cx, cz) };
  }

  leave(id) { this.infrastructure.lastHit.delete(id); this.listener.forget(id); this.encounters.forget(id); return this.players.delete(id); }

  advance(seconds) {
    if (!this.clockState().running) return;
    this.clock.advance(seconds); this.shelters.advance(seconds);
    const players = this.encounterPlayers();
    this.encounters.advance(players);
    this.listener.advance(seconds, players.map(p => ({ ...p, vulnerable: this.encounters.vulnerable(p), downed: this.encounters.downed(p) })));
  }

  processUpkeep() {
    const changes = this.upkeep.step([...this.players.values()].map(player => player.pose));
    this.recordWorldChanges(changes);
    return changes;
  }

  move(id, pose) {
    const player = this.players.get(id);
    if (!player || !pose || !['x', 'y', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(pose[key]))) return false;
    if (pose.x < -32 || pose.x > (this.world.size || SIZE) + 32 || pose.z < -32 || pose.z > (this.world.size || SIZE) + 32 || pose.y < -32 || pose.y > HEIGHT + 12
      || Math.abs(pose.pitch) > Math.PI / 2 + 0.01) return false;
    const encounter = this.encounters.publicState({ ...player, key: player.token });
    if (encounter.revision > 0 && pose.encounterRevision !== encounter.revision) return false;
    if (encounter.state === 'downed') {
      // Downed players can still look around. Keep their observation direction
      // current without accepting movement, activity, or an old encounter pose.
      if (['x', 'y', 'z'].some(axis => pose[axis] !== encounter.position[axis])) return false;
      Object.assign(player.pose, { yaw: pose.yaw % (Math.PI * 2), pitch: pose.pitch, flying: false, active: false });
      return true;
    }
    Object.assign(player.pose, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw % (Math.PI * 2), pitch: pose.pitch,
      flying: false, active: pose.active === true });
    return true;
  }

  expected(x, y, z) {
    return [-1, 0, 1, 2].map(offset => this.world.get(x, y + offset, z));
  }

  command(id, message) {
    const result = this.performCommand(id, message), player = this.players.get(id);
    if (player && message) this.listener.action(id, message.method, message, result, player.pose);
    return result;
  }

  performCommand(id, message) {
    if (!message || typeof message !== 'object') return { ok: false, reason: 'invalid' };
    const player = this.players.get(id);
    if (!player) return { ok: false, reason: 'disconnected' };
    const { method } = message;
    if (RESTRICTED_COMMANDS.has(method)) return { ok: false, reason: 'restricted' };
    if (this.encounters.downed({ key: player.token }) && method !== 'name') return { ok: false, reason: 'downed' };
    if (method === 'rescue') {
      if (message.targetId === null) { this.encounters.rescues.delete(id); return { ok: true, type: 'players' }; }
      return this.encounters.rescue({ ...player, key: player.token }, this.encounterPlayers().find(p => p.id === message.targetId));
    }
    player.history.spendSlot = undefined;
    player.history.attackTime = this.clock.elapsedSeconds;
    if (['inspectUpkeep', 'gatherSalvage', 'repair', 'refuelWard', 'setWardPower'].includes(method)) return this.upkeep.command(method, message, player.inventory, player.pose);
    if (method === 'openStorage' || method === 'storage') return this.infrastructure.storage(method, message, player.inventory, player.pose, randomUUID());
    if (method === 'drop') return this.drops.drop(this.world, player.inventory, player.pose, message, randomUUID(), this.clock.elapsedSeconds * 1000);
    if (method === 'pickup') return this.drops.pickup(this.world, player.inventory, player.pose, this.clock.elapsedSeconds * 1000);
    if (method === 'craft' || method === 'inventory') {
      const result = (method === 'craft' ? player.inventory?.craft(message.block) : player.inventory?.action(message)) || { ok: false, reason: 'invalid' };
      return { ...result, type: 'supplies' };
    }
    if (method === 'name') {
      player.name = cleanName(message.name);
      return { ok: true, type: 'players' };
    }
    if (!['edit', 'placeDoor', 'placeLantern', 'placeFlower', 'toggleDoor'].includes(method)) return { ok: false, reason: 'invalid' };
    const { x, y, z, block, facing, expected } = message;
    if (!this.world.contains(x, y, z)) return { ok: false, reason: 'invalid' };
    if (!Array.isArray(expected) || expected.length !== 4 || expected.some((value, i) => value !== this.expected(x, y, z)[i])) return { ok: false, reason: 'changed' };
    const p = player.pose;
    const distance = Math.hypot(Math.max(x - p.x, 0, p.x - x - 1), Math.max(y - p.y - EYE_HEIGHT, 0, p.y + EYE_HEIGHT - y - 1), Math.max(z - p.z, 0, p.z - z - 1));
    if (distance > 6.75) return { ok: false, reason: 'reach' };
    if (player.inventory && ['edit', 'placeDoor', 'placeLantern', 'placeFlower'].includes(method)) {
      player.history.spendSlot = Number.isInteger(message.slot) ? message.slot : -1;
      if (Number.isInteger(message.slot)) player.inventory.select(message.slot);
    }
    if (method === 'edit') {
      const before = this.world.get(x, y, z);
      if (!isBlock(block) || block === WATER || isSolid(before) && block !== AIR && !(isSlab(before) && block === PLANKS)) return { ok: false, reason: 'invalid' };
      return player.history.edit(x, y, z, block, p);
    }
    if (method === 'placeDoor') return player.history.placeDoor(x, y, z, facing, p, block);
    if (method === 'placeLantern') return player.history.placeLantern(x, y, z, p, block);
    if (method === 'placeFlower' && isFlower(block)) return player.history.placeFlower(x, y, z, block, p);
    if (method === 'toggleDoor') return player.history.toggleDoor(x, y, z, p);
    return { ok: false, reason: 'invalid' };
  }
}
