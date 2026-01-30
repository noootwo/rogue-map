import { PersistenceAdapter, PersistenceType } from "./interfaces";
import { FileSystemAdapter } from "./fs";
import { IndexedDBAdapter, LocalStorageAdapter } from "./browser";

/**
 * PersistenceManager: Factory for creating persistence adapters.
 */
export class PersistenceManager {
  static getAdapter(type: PersistenceType = "auto"): PersistenceAdapter {
    if (type === "auto") {
      if (
        typeof process !== "undefined" &&
        process.versions &&
        process.versions.node
      ) {
        return new FileSystemAdapter();
      }
      if (typeof indexedDB !== "undefined") {
        return new IndexedDBAdapter();
      }
      if (typeof localStorage !== "undefined") {
        return new LocalStorageAdapter();
      }
      throw new Error("No suitable persistence adapter found.");
    }

    switch (type) {
      case "fs":
        return new FileSystemAdapter();
      case "indexeddb":
        return new IndexedDBAdapter();
      case "localstorage":
        return new LocalStorageAdapter();
      case "memory":
        return {
          save: async () => {},
          saveSync: () => {},
          load: async () => null,
          loadSync: () => null,
        };
      default:
        throw new Error(`Unknown persistence type: ${type}`);
    }
  }
}
