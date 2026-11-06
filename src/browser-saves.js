import { validateSave, SaveError } from './saves.js';

let database;
const summary = save => ({ id: save.id, name: save.name, gameMode: save.gameMode || 'creative', world: { seed: save.world?.seed }, createdAt: save.createdAt, updatedAt: save.updatedAt, saveRevision: save.saveRevision || 0 });
async function openDatabase() {
  if (!globalThis.indexedDB) throw new SaveError('Browser storage is unavailable. Use a normal browser window with website storage enabled.', 'SAVE_UNAVAILABLE');
  if (!database) database = new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('blockfield-worlds', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('summaries')) {
        const summaries = db.createObjectStore('summaries', { keyPath: 'id' });
        const cursor = request.transaction.objectStore('worlds').openCursor();
        cursor.onsuccess = () => { if (cursor.result) { summaries.put(summary(cursor.result.value)); cursor.result.continue(); } };
      }
    };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { blocked = true; database = null; reject(new SaveError('Close older Blockfield tabs, then try saving again.', 'SAVE_UNAVAILABLE')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  });
  return database;
}

async function transaction(mode, action, summariesOnly = false) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    const stores = mode === 'readwrite' ? ['worlds', 'summaries'] : [summariesOnly ? 'summaries' : 'worlds'];
    try { tx = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
    catch { tx = db.transaction(stores, mode); }
    let result, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new SaveError('Browser storage could not commit this world.'));
    tx.onerror = () => {};
    action(tx.objectStore(stores[0]), value => { result = value; }, error => { failure = error; tx.abort(); }, mode === 'readwrite' ? tx.objectStore('summaries') : null);
  });
}

export const browserSaves = {
  async list() {
    const saves = await transaction('readonly', (store, result) => { const request = store.getAll(); request.onsuccess = () => result(request.result); }, true);
    return saves.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async load(id) {
    const save = await transaction('readonly', (store, result) => { const request = store.get(id); request.onsuccess = () => result(request.result); });
    if (!save) throw new SaveError('That saved world could not be found.');
    return validateSave(save);
  },
  async remove(id, expectedRevision) {
    return transaction('readwrite', (store, result, abort, summaries) => {
      const request = summaries.get(id);
      request.onsuccess = () => {
        if (request.result && (request.result.saveRevision || 0) !== expectedRevision) {
          abort(new SaveError('This world changed in another tab. Review the refreshed list before deleting it.', 'SAVE_CONFLICT'));
          return;
        }
        store.delete(id); summaries.delete(id);
      };
    });
  },
  async save(save, expectedRevision = 0) {
    validateSave(save);
    return transaction('readwrite', (store, result, abort, summaries) => {
      const request = summaries.get(save.id);
      request.onsuccess = () => {
        const current = request.result?.saveRevision || 0;
        if (current !== expectedRevision) { abort(new SaveError('This world was changed in another tab. Export your current world, then reopen the saved copy.', 'SAVE_CONFLICT')); return; }
        const record = { ...save, saveRevision: current + 1 };
        store.put(record); summaries.put(summary(record)); result(record);
      };
    });
  },
};

export function saveMessage(error) {
  return error?.name === 'QuotaExceededError' ? 'Browser storage is full. Export a backup, free some website storage, then retry saving.'
    : error?.message || 'The browser could not save this world. Export a backup before closing it.';
}
