import { RogueMap } from './src/RogueMap.js';
import { Int32Codec, StringCodec } from './src/codecs.js';

const COUNT = 1_000_000;

function formatBytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemory() {
  if (global.gc) {
    global.gc();
  }
  return process.memoryUsage();
}

async function benchmark() {
  console.log(`Running benchmark with ${COUNT} items...`);
  
  // Baseline
  getMemory();
  const startMem = getMemory();

  // --- Native Map ---
  {
    console.log('\n--- Native Map (String -> Number) ---');
    const map = new Map<string, number>();
    
    const start = performance.now();
    for (let i = 0; i < COUNT; i++) {
      map.set(`key${i}`, i);
    }
    const writeTime = performance.now() - start;
    console.log(`Write: ${writeTime.toFixed(2)}ms`);

    const memAfter = getMemory();
    console.log(`Heap Used: ${formatBytes(memAfter.heapUsed - startMem.heapUsed)}`);
    
    const startRead = performance.now();
    for (let i = 0; i < COUNT; i++) {
      map.get(`key${i}`);
    }
    const readTime = performance.now() - startRead;
    console.log(`Read: ${readTime.toFixed(2)}ms`);
  }

  // Clean up
  if (global.gc) global.gc();
  const midMem = getMemory();

  // --- RogueMap (Optimized) ---
  {
    console.log('\n--- RogueMap (String -> Int32) ---');
    // Pre-allocate enough memory to avoid resizing (fair comparison if we want raw speed, 
    // or allow resize if we want to test that. RogueMap currently throws if full, 
    // so we MUST allocate enough).
    // 1M items. Key ~ 10 bytes. Value 4 bytes. Overhead ~ 9 bytes (flag+len). ~ 23 bytes/entry.
    // 23MB + buckets (1M * 4 = 4MB). ~ 30MB total.
    // Let's alloc 64MB buffer.
    
    const map = new RogueMap<string, number>({
      capacity: COUNT * 1.5, // 1.5M buckets for low collision
      initialMemory: 64 * 1024 * 1024, // 64MB
      keyCodec: StringCodec,
      valueCodec: Int32Codec
    });

    const start = performance.now();
    for (let i = 0; i < COUNT; i++) {
      map.set(`key${i}`, i);
    }
    const writeTime = performance.now() - start;
    console.log(`Write: ${writeTime.toFixed(2)}ms`);

    const memAfter = getMemory();
    // RogueMap uses Buffer (external/arrayBuffer) + Int32Array (typed array).
    // Heap Used might increase slightly (wrappers), but External/ArrayBuffers will increase.
    console.log(`Heap Used: ${formatBytes(memAfter.heapUsed - midMem.heapUsed)}`);
    console.log(`External/ArrayBuffer: ${formatBytes(memAfter.external + memAfter.arrayBuffers - (midMem.external + midMem.arrayBuffers))}`);
    console.log(`Total Memory Delta: ${formatBytes((memAfter.rss - midMem.rss))}`);

    const startRead = performance.now();
    for (let i = 0; i < COUNT; i++) {
      map.get(`key${i}`);
    }
    const readTime = performance.now() - startRead;
    console.log(`Read: ${readTime.toFixed(2)}ms`);
  }
}

benchmark().catch(console.error);
