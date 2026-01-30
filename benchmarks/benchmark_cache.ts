import { RogueMap } from './src/RogueMap.js';
import { Int32Codec, StringCodec } from './src/codecs.js';

const COUNT = 1_000_000;

function formatBytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemory() {
  if (global.gc) global.gc();
  return process.memoryUsage();
}

async function benchmark() {
  console.log(`Running Cache Benchmark with ${COUNT} items...\n`);

  // --- No Cache ---
  {
    if (global.gc) global.gc();
    const map = new RogueMap<string, number>({
      capacity: COUNT * 1.5,
      initialMemory: 128 * 1024 * 1024,
      keyCodec: StringCodec,
      valueCodec: Int32Codec,
      cacheSize: 0 // Disabled
    });

    // Fill
    for (let i = 0; i < COUNT; i++) map.set(`key${i}`, i);

    // Read All (Miss)
    const start = performance.now();
    for (let i = 0; i < COUNT; i++) map.get(`key${i}`);
    const time = performance.now() - start;
    
    console.log(`[No Cache] Read Time: ${time.toFixed(2)}ms`);
  }

  // --- With Cache (Cold) ---
  {
    if (global.gc) global.gc();
    const map = new RogueMap<string, number>({
      capacity: COUNT * 1.5,
      initialMemory: 128 * 1024 * 1024,
      keyCodec: StringCodec,
      valueCodec: Int32Codec,
      cacheSize: 1000 // Small cache
    });

    // Fill (populates cache for last 1000 items)
    for (let i = 0; i < COUNT; i++) map.set(`key${i}`, i);

    // Read All (Mostly Miss)
    const start = performance.now();
    for (let i = 0; i < COUNT; i++) map.get(`key${i}`);
    const time = performance.now() - start;
    
    console.log(`[With Cache 1000] Read Time (Cold/Scan): ${time.toFixed(2)}ms`);
  }
  
  // --- With Cache (Hot) ---
  {
      if (global.gc) global.gc();
      const map = new RogueMap<string, number>({
        capacity: COUNT * 1.5,
        initialMemory: 128 * 1024 * 1024,
        keyCodec: StringCodec,
        valueCodec: Int32Codec,
        cacheSize: 10_000 
      });
  
      // Fill
      for (let i = 0; i < COUNT; i++) map.set(`key${i}`, i);
      
      // Access Hot Set (last 1000 items) repeatedly
      const HOT_COUNT = 1000;
      const ITERATIONS = 1000; // 1M accesses total
      
      // Prime Cache
      for (let i = 0; i < HOT_COUNT; i++) map.get(`key${i}`);
      
      const start = performance.now();
      for (let j = 0; j < ITERATIONS; j++) {
          for (let i = 0; i < HOT_COUNT; i++) {
              map.get(`key${i}`);
          }
      }
      const time = performance.now() - start;
      
      console.log(`[With Cache 10k] Read Time (Hot 1k Loop): ${time.toFixed(2)}ms`);
      
      // Compare with No Cache Hot Loop
      const mapNoCache = new RogueMap<string, number>({
        capacity: COUNT * 1.5,
        initialMemory: 128 * 1024 * 1024,
        keyCodec: StringCodec,
        valueCodec: Int32Codec,
        cacheSize: 0
      });
      for (let i = 0; i < COUNT; i++) mapNoCache.set(`key${i}`, i);
      
      const start2 = performance.now();
      for (let j = 0; j < ITERATIONS; j++) {
          for (let i = 0; i < HOT_COUNT; i++) {
              mapNoCache.get(`key${i}`);
          }
      }
      const time2 = performance.now() - start2;
      console.log(`[No Cache] Read Time (Hot 1k Loop): ${time2.toFixed(2)}ms`);
  }
}

if (!global.gc) {
    console.error('Run with node --expose-gc --import tsx benchmark_cache.ts');
} else {
    benchmark().catch(console.error);
}
