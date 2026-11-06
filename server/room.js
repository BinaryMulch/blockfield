import { randomUUID } from 'node:crypto';
import { SIZE, HEIGHT, AIR, WATER, PLANKS, EYE_HEIGHT, isBlock, isSolid, isSlab, isFlower, overlapsBlock, spawnPlayer } from '../src/world.js';
import { EditHistory } from '../src/history.js';
import { DayClock } from '../src/clock.js';
import { ChunkWorld } from '../src/chunks.js';
import { CHUNK_SIZE, chunkKey, chunkIndex } from '../src/generation.js';
import { captureSave, restoreEdits, validPlayerToken } from '../src/saves.js';
import { Inventory, emptyGatherInventory, GAME_MODES } from '../src/inventory.js';
import { ItemDrops } from '../src/drops.js';

export const PROTOCOL = 5;
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
    if (!result.ok) return result;
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

  constructor({ world = new ChunkWorld({ seed: process.env.WORLD_SEED || 'Blockfield' }), maxPlayers = MAX_PLAYERS, name = process.env.WORLD_NAME || 'Blockfield Together', gameMode = process.env.GAME_MODE || 'gather' } = {}) {
    if (!GAME_MODES.includes(gameMode)) throw new Error('GAME_MODE must be creative or gather.');
    this.gameMode = gameMode;
    this.profiles = new Map();
    this.world = world;
    this.maxPlayers = maxPlayers;
    this.versions = new Map();
    this.chunkRevisions = new Map();
    this.name = String(name).slice(0, 40);
    this.sessionId = randomUUID();
    this.worldId = randomUUID();
    this.createdAt = Date.now();
  }

  toSave() { return captureSave({ world: this.world, id: this.worldId, name: this.name, createdAt: this.createdAt, clock: this.clock, gameMode: this.gameMode,
    ...(this.gameMode === 'gather' ? { profiles: [...this.profiles].map(([token, inventory]) => [token, inventory.snapshot()]), drops: this.drops.snapshot() } : {}) }); }

  static fromSave(save) {
    const world = new ChunkWorld({ seed: save.world.seed, size: save.world.size });
    restoreEdits(world, save);
    const room = new GameRoom({ world, name: save.name, gameMode: save.gameMode || 'creative' });
    room.profiles = new Map((save.profiles || []).map(([token, inventory]) => [token, new Inventory(inventory)]));
    room.drops = new ItemDrops(save.drops);
    room.worldId = save.id; room.createdAt = save.createdAt;
    room.clock.phase = save.clock.phase; room.clock.held = save.clock.held;
    return room;
  }

  join(name, token) {
    if (this.players.size >= this.maxPlayers) return null;
    if (this.gameMode === 'gather') {
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
    Object.assign(pose, { yaw: 0, pitch: -0.12, active: false });
    const player = { id, name: cleanName(name), color: COLORS[this.colorIndex++ % COLORS.length], pose, history: new SharedHistory(this) };
    if (this.gameMode === 'gather') {
      player.token = token; player.inventory = this.profiles.get(token); player.history.inventory = player.inventory;
    }
    this.players.set(id, player);
    return player;
  }

  publicPlayer(player) {
    return { id: player.id, name: player.name, color: player.color, ...player.pose };
  }

  playerList() { return [...this.players.values()].map(player => this.publicPlayer(player)); }
  clockState() { return { phase: this.clock.phase, held: this.clock.held, running: [...this.players.values()].some(p => p.pose.active) }; }

  metadata() { return this.world.metadata?.() || { size: SIZE, height: HEIGHT, chunkSize: CHUNK_SIZE, seed: 'test', generator: 0 }; }

  snapshot(player) {
    return { type: 'welcome', protocol: PROTOCOL, sessionId: this.sessionId, worldId: this.worldId, self: this.publicPlayer(player), players: this.playerList(),
      world: this.metadata(), worldName: this.name, revision: this.revision, clock: this.clockState(), maxPlayers: this.maxPlayers, gameMode: this.gameMode, drops: this.drops.snapshot(),
      ...(player.inventory ? { inventory: player.inventory.snapshot(), playerToken: player.token } : {}) };
  }

  chunkSnapshot(cx, cz) {
    const key = chunkKey(cx, cz);
    let blocks = this.world.getChunk?.(cx, cz)?.blocks;
    if (!blocks) {
      blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * HEIGHT);
      for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) blocks[chunkIndex(x, y, z)] = this.world.get(cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z);
    }
    return { type: 'chunk', cx, cz, revision: this.chunkRevisions.get(key) || 0, blocks: Buffer.from(blocks).toString('base64') };
  }

  leave(id) { return this.players.delete(id); }

  advance(seconds) {
    if (this.clockState().running) this.clock.advance(seconds);
  }

  move(id, pose) {
    const player = this.players.get(id);
    if (!player || !pose || !['x', 'y', 'z', 'yaw', 'pitch'].every(key => Number.isFinite(pose[key]))) return false;
    if (pose.x < -32 || pose.x > (this.world.size || SIZE) + 32 || pose.z < -32 || pose.z > (this.world.size || SIZE) + 32 || pose.y < -32 || pose.y > HEIGHT + 12
      || Math.abs(pose.pitch) > Math.PI / 2 + 0.01) return false;
    Object.assign(player.pose, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw % (Math.PI * 2), pitch: pose.pitch,
      flying: pose.flying === true, active: pose.active === true });
    return true;
  }

  expected(x, y, z) {
    return [-1, 0, 1, 2].map(offset => this.world.get(x, y + offset, z));
  }

  command(id, message) {
    if (!message || typeof message !== 'object') return { ok: false, reason: 'invalid' };
    const player = this.players.get(id);
    if (!player) return { ok: false, reason: 'disconnected' };
    const { method } = message;
    player.history.spendSlot = undefined;
    if (method === 'drop') return this.drops.drop(this.world, player.inventory, player.pose, message, randomUUID());
    if (method === 'pickup') return this.drops.pickup(this.world, player.inventory, player.pose);
    if (method === 'craft' || method === 'inventory') {
      const result = (method === 'craft' ? player.inventory?.craft(message.block) : player.inventory?.action(message)) || { ok: false, reason: 'invalid' };
      return { ...result, type: 'supplies' };
    }
    if (method === 'name') {
      player.name = cleanName(message.name);
      return { ok: true, type: 'players' };
    }
    if (method === 'time') {
      if (message.action === 'hold') this.clock.held = !this.clock.held;
      else if (message.action === 'next') this.clock.next();
      else return { ok: false, reason: 'invalid' };
      return { ok: true, type: 'clock' };
    }
    if (method === 'undo' || method === 'redo') return player.history[method](player.pose);
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
    if (method === 'placeDoor') return player.history.placeDoor(x, y, z, facing, p);
    if (method === 'placeLantern') return player.history.placeLantern(x, y, z, p);
    if (method === 'placeFlower' && isFlower(block)) return player.history.placeFlower(x, y, z, block, p);
    if (method === 'toggleDoor') return player.history.toggleDoor(x, y, z, p);
    return { ok: false, reason: 'invalid' };
  }
}
