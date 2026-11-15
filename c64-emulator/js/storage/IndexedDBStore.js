const DB_NAME = 'c64-emulator';
const DB_VERSION = 1;
export const STORES = Object.freeze({ ROMS: 'roms', FILES: 'files', SETTINGS: 'settings' });

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDBStore {
  constructor(factory = globalThis.indexedDB) {
    this.factory = factory;
    this.db = null;
  }

  get available() {
    return !!this.factory;
  }

  async open() {
    if (this.db) {
      return this.db;
    }
    if (!this.factory) {
      throw new Error('IndexedDB nicht verfügbar');
    }
    const request = this.factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    this.db = await promisify(request);
    return this.db;
  }

  async transaction(store, mode, action) {
    const db = await this.open();
    const tx = db.transaction(store, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const result = await promisify(action(tx.objectStore(store)));
    await done;
    return result;
  }

  put(store, key, value) {
    return this.transaction(store, 'readwrite', (s) => s.put(value, key));
  }

  get(store, key) {
    return this.transaction(store, 'readonly', (s) => s.get(key));
  }

  delete(store, key) {
    return this.transaction(store, 'readwrite', (s) => s.delete(key));
  }

  keys(store) {
    return this.transaction(store, 'readonly', (s) => s.getAllKeys());
  }
}
