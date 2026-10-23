// Extension-origin IndexedDB is not the host-origin IndexedDB seen by content scripts.
// No generic storage messaging API is exposed to pages.
type LegacyStorage = {
  get(key: null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
};
const DB_NAME = 'clickdeck-private-collaboration-v1';
const STORE = 'secrets';
const isPrivateKey = (key: string) => key === 'clickdeck:collaboration-auth:v1'
  || key.startsWith('clickdeck:collaboration-auth:v1:') || key.startsWith('clickdeck:secure-invite:');

export function createPrivateCollaborationStorage(options: { legacy?: LegacyStorage; factory?: IDBFactory } = {}) {
  let initialized: Promise<void> | undefined;

  async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = (options.factory ?? indexedDB).open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(new Error('identity-storage-failed'));
      request.onblocked = () => reject(new Error('identity-storage-failed'));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => () => T): Promise<T> {
    const db = await database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        tx.onabort = tx.onerror = () => reject(new Error('identity-storage-failed'));
        try {
          const result = run(tx.objectStore(STORE));
          // Request success is not a commit. Only acknowledge the complete transaction.
          tx.oncomplete = () => resolve(result());
        } catch { tx.abort(); reject(new Error('identity-storage-failed')); }
      });
    } finally { db.close(); }
  }

  async function migrate() {
    const legacy = options.legacy ?? chrome.storage.local;
    const old = await legacy.get(null);
    const keys = Object.keys(old).filter(isPrivateKey);
    const entries = Object.fromEntries(keys.map(key => [key, old[key]]));
    const repairs: Record<string, unknown> = {};
    // Older versions embedded the owner's invitation in public participation records.
    for (const [key, value] of Object.entries(old)) {
      if (!value || typeof value !== 'object') continue;
      const row = value as Record<string, unknown>;
      const address = key.startsWith('clickdeck:collaboration-url:v1:');
      if (!address && !key.startsWith('clickdeck:collaboration-page:v1:')) continue;
      const p = (address ? row.participation : row) as Record<string, unknown> | undefined;
      if (!p || typeof p.projectId !== 'string' || typeof p.inviteCode !== 'string') continue;
      entries['clickdeck:secure-invite:' + p.projectId] ??= p.inviteCode;
      const { inviteCode: _invite, ...safe } = p;
      repairs[key] = address ? { ...row, participation: safe } : safe;
    }
    if (!Object.keys(entries).length) return;
    await transaction('readwrite', store => {
      for (const key of Object.keys(entries)) {
        const existing = store.get(key);
        existing.onsuccess = () => {
          // A retry after legacy cleanup failure must not roll back newer credentials.
          if (existing.result === undefined) store.put(entries[key], key);
        };
      }
      return () => undefined;
    });
    if (Object.keys(repairs).length) await legacy.set(repairs);
    if (keys.length) await legacy.remove(keys);
  }

  async function initialize() {
    initialized ??= migrate().catch(() => { initialized = undefined; throw new Error('identity-storage-failed'); });
    await initialized;
  }
  function validate(keys: string[]) {
    if (keys.some(key => !isPrivateKey(key))) throw new Error('invalid-private-storage-key');
  }
  return {
    initialize,
    async get(key: string): Promise<Record<string, unknown>> {
      validate([key]); await initialize();
      return transaction('readonly', store => { const value = store.get(key); return () => ({ [key]: value.result }); });
    },
    async set(values: Record<string, unknown>): Promise<void> {
      validate(Object.keys(values)); await initialize();
      await transaction('readwrite', store => { for (const [key, value] of Object.entries(values)) store.put(value, key); return () => undefined; });
    },
    async remove(key: string): Promise<void> {
      validate([key]); await initialize();
      await transaction('readwrite', store => { store.delete(key); return () => undefined; });
    }
  };
}
