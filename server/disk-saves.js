import { open, readFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateSave, SaveError, MAX_SAVE_BYTES } from '../src/saves.js';

async function atomicWrite(filename, text) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, filename);
    const directory = await open(path.dirname(filename), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
}

export class DiskWorldStore {
  constructor(directory) { this.directory = path.resolve(directory); this.filename = path.join(this.directory, 'world.json'); }

  async lock() {
    await mkdir(this.directory, { recursive: true });
    this.lockfile = path.join(this.directory, '.world.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(this.lockfile, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify({ pid: process.pid })); await file.sync(); }
        catch (error) { await rm(this.lockfile, { force: true }).catch(() => {}); throw error; }
        finally { await file.close(); }
        this.locked = true; return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Serialize stale-lock reclamation too: two restarting hosts must not
        // both unlink an old lock after one has already acquired the new one.
        const reclaimPath = path.join(this.directory, '.world.reclaim');
        let gate;
        try {
          gate = await open(reclaimPath, 'wx', 0o600);
          let pid;
          try { pid = JSON.parse(await readFile(this.lockfile, 'utf8')).pid; }
          catch (failure) { if (failure.code === 'ENOENT') continue; }
          if (Number.isInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); } catch (failure) {
              if (failure.code === 'ESRCH') { await rm(this.lockfile, { force: true }); continue; }
            }
          }
        } catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
        finally { if (gate) { await gate.close(); await rm(reclaimPath, { force: true }); } }
        const failure = new Error(`Another host may be using ${this.directory}. Stop it before opening this saved world.`);
        failure.code = 'EWORLDLOCKED'; throw failure;
      }
    }
    throw new Error('The saved world could not be locked. Try starting the host again.');
  }

  async read(filename) {
    if ((await stat(filename)).size > MAX_SAVE_BYTES) throw new SaveError('The save exceeds this version’s supported size.', 'SAVE_INCOMPATIBLE');
    return validateSave(JSON.parse(await readFile(filename, 'utf8')));
  }

  async load() {
    try {
      const save = await this.read(this.filename);
      this.previous = JSON.stringify(save); return save;
    } catch (error) {
      if (error.code === 'SAVE_INCOMPATIBLE') throw error;
      if (!(error instanceof SyntaxError) && !['ENOENT', 'SAVE_INVALID'].includes(error.code)) {
        throw new Error(`Cannot read ${this.filename}. Check storage and permissions; existing files were preserved. ${error.message}`);
      }
      let backup;
      try { backup = await this.read(`${this.filename}.bak`); } catch (failure) {
        if (error.code === 'ENOENT' && failure.code === 'ENOENT') return null;
        throw new Error(`Cannot load ${this.filename} or its backup. Existing files were preserved. ${error.message}`);
      }
      this.previous = JSON.stringify(backup);
      this.recovered = true;
      return backup;
    }
  }

  async save(save) {
    const text = JSON.stringify(validateSave(save));
    if (Buffer.byteLength(text) > MAX_SAVE_BYTES) throw new SaveError('This world has reached the supported save size.');
    if (this.previous) await atomicWrite(`${this.filename}.bak`, this.previous);
    await atomicWrite(this.filename, text);
    this.previous = text;
    this.savedAt = save.updatedAt;
  }

  async close() {
    if (this.locked) { this.locked = false; await rm(this.lockfile, { force: true }); }
  }
}
