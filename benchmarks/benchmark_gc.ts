import { RogueMap } from './src/RogueMap.js';
import { Int32Codec, StringCodec } from './src/codecs.js';

const COUNT = 2_000_000; // 2 Million items

function formatBytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemory() {
  if (global.gc) global.gc();
  return process.memoryUsage();
}

async function benchmark() {
  console.log(`\nStarting GC Benchmark with ${COUNT} items...`);
  console.log(`(Measuring time taken to perform a full Garbage Collection scan)`);
  
  // --- Native Map ---
  {
    if (global.gc) global.gc();
    const map = new Map<string, number>();
    
    // Fill Map
    for (let i = 0; i < COUNT; i++) {
      map.set(`key${i}`, i);
    }
    
    // Measure GC
    const start = performance.now();
    if (global.gc) global.gc();
    const end = performance.now();
    
    console.log(`\n[Native Map]`);
    console.log(`GC Pause Time: ${(end - start).toFixed(2)} ms`);
    console.log(`Objects Tracked: ~${COUNT} (Keys + Values + Internal Nodes)`);
  }

  // --- RogueMap ---
  {
    if (global.gc) global.gc();
    const map = new RogueMap<string, number>({
      capacity: COUNT * 1.5,
      initialMemory: 128 * 1024 * 1024,
      keyCodec: StringCodec,
      valueCodec: Int32Codec
    });

    // Fill Map
    for (let i = 0; i < COUNT; i++) {
      map.set(`key${i}`, i);
    }

    // Measure GC
    const start = performance.now();
    if (global.gc) global.gc();
    const end = performance.now();
    
    console.log(`\n[RogueMap]`);
    console.log(`GC Pause Time: ${(end - start).toFixed(2)} ms`);
    console.log(`Objects Tracked: ~1 (The Buffer)`);
  }
}

if (!global.gc) {
    console.error('Run with node --expose-gc --import tsx benchmark_gc.ts');
} else {
    benchmark().catch(console.error);
}
