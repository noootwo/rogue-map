import { PersistenceAdapter } from "./interfaces";
import { Buffer } from "../internal/buffer";

/**
 * IndexedDBAdapter: Persistence adapter for Browser IndexedDB.
 * Suitable for storing large amounts of data asynchronously.
 */
export class IndexedDBAdapter implements PersistenceAdapter {
  private dbName = "RogueMapDB";
  private storeName = "store";

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Check if store exists to avoid error on version upgrade (though we use v1)
        if (!db.objectStoreNames.contains(this.storeName)) {
          // Create object store WITHOUT keyPath, so we must provide key in put/get
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  async save(data: Buffer, key: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      // IndexedDB can store Blob or ArrayBuffer. Buffer is Uint8Array subclass.
      const request = store.put(data, key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  saveSync(data: Buffer, key: string): void {
    throw new Error("IndexedDB does not support synchronous operations.");
  }

  async load(key: string): Promise<Buffer | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) resolve(null);
        else resolve(Buffer.from(result));
      };
    });
  }

  loadSync(key: string): Buffer | null {
    throw new Error("IndexedDB does not support synchronous operations.");
  }
}

export class LocalStorageAdapter implements PersistenceAdapter {
  save(data: Buffer, key: string): Promise<void> {
    this.saveSync(data, key);
    return Promise.resolve();
  }

  saveSync(data: Buffer, key: string): void {
    const base64 = data.toString("base64");
    localStorage.setItem(key, base64);
  }

  load(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.loadSync(key));
  }

  loadSync(key: string): Buffer | null {
    const base64 = localStorage.getItem(key);
    if (!base64) return null;
    return Buffer.from(base64, "base64");
  }
}
