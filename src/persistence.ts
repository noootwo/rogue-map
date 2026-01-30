import { RogueMap, RogueMapOptions } from "./RogueMap";
import * as fs from "fs";

/**
 * Saves a RogueMap instance synchronously to a file.
 *
 * @param map The map instance to save.
 * @param path The file path to save to.
 */
export function saveSync<K, V>(map: RogueMap<K, V>, path: string): void {
  const data = map.serialize();
  fs.writeFileSync(path, data);
}

/**
 * Loads a RogueMap from a file synchronously.
 *
 * @param path The file path to load from.
 * @param options Configuration options for the new map instance.
 */
export function loadSync<K, V>(
  path: string,
  options: RogueMapOptions<K, V> = {},
): RogueMap<K, V> {
  const data = fs.readFileSync(path);
  return RogueMap.deserialize(data, options);
}

/**
 * Saves the RogueMap to a file asynchronously.
 *
 * @param map The map instance to save.
 * @param path The file path to save to.
 */
export async function save<K, V>(
  map: RogueMap<K, V>,
  path: string,
): Promise<void> {
  const data = map.serialize();
  await fs.promises.writeFile(path, data);
}

/**
 * Loads a RogueMap from a file asynchronously.
 *
 * @param path The file path to load from.
 * @param options Configuration options for the new map instance.
 */
export async function load<K, V>(
  path: string,
  options: RogueMapOptions<K, V> = {},
): Promise<RogueMap<K, V>> {
  const data = await fs.promises.readFile(path);
  return RogueMap.deserialize(data, options);
}
