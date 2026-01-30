import { PersistenceAdapter } from "./interfaces";
import * as fs from "fs";
import * as path from "path";

/**
 * FileSystemAdapter: Persistence adapter for Node.js File System.
 * Supports both sync and async operations.
 */
export class FileSystemAdapter implements PersistenceAdapter {
  async save(data: Buffer, filePath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, data);
  }

  saveSync(data: Buffer, filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
  }

  async load(filePath: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(filePath);
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  loadSync(filePath: string): Buffer | null {
    try {
      return fs.readFileSync(filePath);
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
}
