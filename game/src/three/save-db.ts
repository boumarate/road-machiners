// Where saves and run logs live. The browser keeps them in IndexedDB, which stores objects as they are, writes each
// transaction whole or not at all, and has a quota sized to the disk. Tests keep them in memory.

import { reportError } from './crash';
import { slotKey, type SlotId } from './save-slots';

// One line of a run's log. seq rises by one per record within a run.
export type LogRecord = { runId: string; seq: number; kind: string } & Record<string, unknown>;

export type SaveBackend = {
  readAll(): Promise<Map<SlotId, unknown>>;
  put(slot: SlotId, envelope: unknown): Promise<void>;
  remove(slot: SlotId): Promise<void>;
  appendLog(records: readonly LogRecord[]): Promise<void>;
  readLog(runId: string): Promise<LogRecord[]>;
};

const SAVES = 'saves';
const LOG = 'log';

// The database of one save scope. Version 1 holds the saves by slot and the log by run id and seq.
export async function idbBackend(name: string): Promise<SaveBackend> {
  const db = await opened(name);
  return {
    readAll: async () => {
      const tx = db.transaction(SAVES, 'readonly');
      const [keys, values] = await Promise.all([request(tx.objectStore(SAVES).getAllKeys()), request(tx.objectStore(SAVES).getAll())]);
      return new Map(keys.map((key, i) => [key as SlotId, values[i]]));
    },
    put: (slot, envelope) => written(db, SAVES, (store) => store.put(envelope, slot)),
    remove: (slot) => written(db, SAVES, (store) => store.delete(slot)),
    appendLog: (records) => written(db, LOG, (store) => records.forEach((r) => store.add(r))),
    readLog: (runId) => request(db.transaction(LOG, 'readonly').objectStore(LOG).getAll(IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]))),
  };
}

function opened(name: string): Promise<IDBDatabase> {
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(SAVES);
    open.result.createObjectStore(LOG, { keyPath: ['runId', 'seq'] });
  };
  return request(open);
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// A write that resolves once the browser has put it on disk, not when it reached the browser's memory.
function written(db: IDBDatabase, store: string, write: (store: IDBObjectStore) => void): Promise<void> {
  const tx = db.transaction(store, 'readwrite', { durability: 'strict' });
  write(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error(`The ${store} write was aborted`));
  });
}

export function memoryBackend(): SaveBackend {
  const saves = new Map<SlotId, unknown>();
  const log: LogRecord[] = [];
  return {
    readAll: async () => new Map([...saves].map(([slot, envelope]) => [slot, structuredClone(envelope)])),
    put: async (slot, envelope) => { saves.set(slot, structuredClone(envelope)); },
    remove: async (slot) => { saves.delete(slot); },
    appendLog: async (records) => { log.push(...records.map((r) => structuredClone(r))); },
    readLog: async (runId) => log.filter((r) => r.runId === runId),
  };
}

// The save slots, mirrored in memory so the game reads and writes them at once. A write goes on to the backend in the
// background, and a failed one goes to onError.
export class SaveSlots {
  onError: (err: unknown) => void = reportError;

  // envelopes must be what the backend holds.
  constructor(readonly backend: SaveBackend, private envelopes: Map<SlotId, unknown>) {}

  // Opens the slots and moves every save left in local storage by older builds into the backend. A save that does
  // not parse moves as its raw text, so load reports it like any other unreadable save.
  static async open(backend: SaveBackend, legacy: Storage, base: string, slots: readonly SlotId[]): Promise<SaveSlots> {
    for (const slot of slots) {
      const key = slotKey(base, slot);
      const raw = legacy.getItem(key);
      if (raw === null) continue;
      await backend.put(slot, parsedOrRaw(raw));
      legacy.removeItem(key);
    }
    return new SaveSlots(backend, await backend.readAll());
  }

  // A copy, so the world loaded from it never changes the mirror.
  get(slot: SlotId): unknown {
    const envelope = this.envelopes.get(slot);
    return envelope === undefined ? null : structuredClone(envelope);
  }

  has(slot: SlotId): boolean {
    return this.envelopes.has(slot);
  }

  put(slot: SlotId, envelope: unknown): void {
    const copy = structuredClone(envelope);
    this.envelopes.set(slot, copy);
    this.backend.put(slot, copy).catch((err) => this.onError(err));
  }

  remove(slot: SlotId): void {
    this.envelopes.delete(slot);
    this.backend.remove(slot).catch((err) => this.onError(err));
  }
}

function parsedOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
