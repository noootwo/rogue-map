
import { RogueMap } from "../src/RogueMap";
import { StringCodec, Int32Codec } from "../src/codecs";

const ITEM_COUNT = 1_000_000;

function run() {
  console.log(`# API Performance Benchmark (${ITEM_COUNT.toLocaleString()} items)\n`);
  
  // Warmup
  console.log('Warming up...');
  const warmupMap = new RogueMap({ capacity: 10000 });
  for(let i=0; i<5000; i++) warmupMap.set('k'+i, i);
  for(let i=0; i<5000; i++) warmupMap.get('k'+i);

  const map = new RogueMap({
    capacity: ITEM_COUNT * 1.5,
    initialMemory: ITEM_COUNT * 40,
    keyCodec: StringCodec,
    valueCodec: Int32Codec
  });

  // 1. Fill
  global.gc?.();
  const startFill = performance.now();
  for (let i = 0; i < ITEM_COUNT; i++) {
    map.set('key' + i, i);
  }
  const endFill = performance.now();
  console.log(`Set (Fill): ${(endFill - startFill).toFixed(2)}ms`);

  // 2. Has (Hit)
  global.gc?.();
  const startHasHit = performance.now();
  for (let i = 0; i < ITEM_COUNT; i++) {
    map.has('key' + i);
  }
  const endHasHit = performance.now();
  console.log(`Has (Hit): ${(endHasHit - startHasHit).toFixed(2)}ms`);

  // 3. Has (Miss)
  global.gc?.();
  const startHasMiss = performance.now();
  for (let i = 0; i < ITEM_COUNT; i++) {
    map.has('miss' + i);
  }
  const endHasMiss = performance.now();
  console.log(`Has (Miss): ${(endHasMiss - startHasMiss).toFixed(2)}ms`);

  // 4. forEach
  global.gc?.();
  const startForEach = performance.now();
  let count = 0;
  map.forEach((v, k) => {
    count++;
  });
  const endForEach = performance.now();
  console.log(`forEach: ${(endForEach - startForEach).toFixed(2)}ms (Count: ${count})`);

  // 5. Iterator: keys
  global.gc?.();
  const startKeys = performance.now();
  let kCount = 0;
  for (const k of map.keys()) {
    kCount++;
  }
  const endKeys = performance.now();
  console.log(`Iterator: keys: ${(endKeys - startKeys).toFixed(2)}ms`);

  // 6. Iterator: values
  global.gc?.();
  const startValues = performance.now();
  let vCount = 0;
  for (const v of map.values()) {
    vCount++;
  }
  const endValues = performance.now();
  console.log(`Iterator: values: ${(endValues - startValues).toFixed(2)}ms`);

  // 7. Iterator: entries
  global.gc?.();
  const startEntries = performance.now();
  let eCount = 0;
  for (const [k, v] of map.entries()) {
    eCount++;
  }
  const endEntries = performance.now();
  console.log(`Iterator: entries: ${(endEntries - startEntries).toFixed(2)}ms`);

  // 8. Delete (Hit)
  // Delete half
  global.gc?.();
  const startDelete = performance.now();
  for (let i = 0; i < ITEM_COUNT / 2; i++) {
    map.delete('key' + i);
  }
  const endDelete = performance.now();
  console.log(`Delete (50%): ${(endDelete - startDelete).toFixed(2)}ms (Size: ${map.size})`);

  // 9. Clear
  global.gc?.();
  const startClear = performance.now();
  map.clear();
  const endClear = performance.now();
  console.log(`Clear: ${(endClear - startClear).toFixed(2)}ms (Size: ${map.size})`);
}

run();
