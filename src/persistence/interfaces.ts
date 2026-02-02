export interface PersistenceAdapter {
  /**
   * Save data to storage.
   */
  save(data: Buffer, key: string): Promise<void>;

  /**
   * Save data synchronously (if supported).
   */
  saveSync(data: Buffer, key: string): void;

  /**
   * Load data from storage.
   */
  load(key: string): Promise<Buffer | null>;

  /**
   * Load data synchronously (if supported).
   */
  loadSync(key: string): Buffer | null;
}

export type PersistenceType =
  | "fs"
  | "indexeddb"
  | "localstorage"
  | "memory"
  | "auto";

export interface PersistenceOptions {
  /**
   * Persistence type. Default 'auto'.
   */
  type?: PersistenceType;

  /**
   * File path (Node) or Storage Key (Browser).
   */
  path: string;

  /**
   * Auto save interval in ms. If 0, auto save is disabled.
   * Default: 0
   */
  saveInterval?: number;

  /**
   * If true, try to load data synchronously in constructor.
   * Note: Only works for 'fs' and 'localstorage'.
   * Default: true for 'fs', false for others.
   */
  syncLoad?: boolean;
}

export interface CompactionOptions {
  /**
   * Enable auto compaction.
   * Default: true
   */
  autoCompact?: boolean;

  /**
   * Compaction threshold (ratio of deleted items).
   * Range: 0.0 - 1.0. Default: 0.3 (30%)
   */
  threshold?: number;

  /**
   * Minimum size (number of items) to trigger compaction.
   * Default: 1000
   */
  minSize?: number;
}
