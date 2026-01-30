
import { RogueMap } from "../src/RogueMap";
import { StringCodec } from "../src/codecs";

const formatBytes = (bytes: number) => {
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 Byte";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
};

const runBenchmark = async () => {
  const targetSize = parseInt(process.argv[2] || "1000000", 10);
  console.log(`Starting Large Scale String Benchmark for ${targetSize.toLocaleString()} items...`);

  if (global.gc) {
    global.gc();
  }

  const initialMemory = process.memoryUsage();
  console.log("Initial Memory:");
  console.log(`  RSS: ${formatBytes(initialMemory.rss)}`);
  console.log(`  Heap Used: ${formatBytes(initialMemory.heapUsed)}`);
  console.log(`  External: ${formatBytes(initialMemory.external)}`);

  try {
    // Key: "key_123456" (10 chars)
    // Val: "val_123456" (10 chars)
    // Overhead: 5 + 4 + 4 + 10 + 10 = 33 bytes per entry
    const map = new RogueMap<string, string>({
        capacity: targetSize * 1.5,
        initialMemory: targetSize * 40, // Safer margin
        keyCodec: StringCodec,
        valueCodec: StringCodec,
    });

    console.log("\n--- WRITE PHASE ---");
    const startWrite = performance.now();
    for (let i = 0; i < targetSize; i++) {
        const k = `key_${i}`;
        const v = `val_${i}`;
        map.set(k, v);
        if (i % 1000000 === 0 && i > 0) {
            const currentMem = process.memoryUsage();
            console.log(`  Written ${i.toLocaleString()} items. RSS: ${formatBytes(currentMem.rss)}`);
        }
    }
    const endWrite = performance.now();
    console.log(`Write Complete in ${((endWrite - startWrite) / 1000).toFixed(2)}s`);
    console.log(`Throughput: ${(targetSize / ((endWrite - startWrite) / 1000)).toLocaleString()} ops/sec`);

    console.log("\n--- READ PHASE (Random Sample 100k) ---");
    const sampleSize = 100000;
    const startRead = performance.now();
    let found = 0;
    for (let i = 0; i < sampleSize; i++) {
        const k = `key_${Math.floor(Math.random() * targetSize)}`;
        if (map.get(k) !== undefined) found++;
    }
    const endRead = performance.now();
    console.log(`Read 100k items in ${((endRead - startRead) / 1000).toFixed(2)}s`);
    console.log(`Throughput: ${(sampleSize / ((endRead - startRead) / 1000)).toLocaleString()} ops/sec`);
    console.log(`Hit Rate: ${(found / sampleSize) * 100}%`);

  } catch (e) {
    console.error("\nCRITICAL ERROR:");
    console.error(e);
  }
};

runBenchmark().catch(console.error);
