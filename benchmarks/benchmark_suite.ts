import { RogueMap } from "./src/RogueMap.js";
import { Int32Codec, StringCodec, JSONCodec } from "./src/codecs.js";

const ITERATIONS = 1_000_000;

function formatBytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function getMemory() {
  if (global.gc) global.gc();
  return process.memoryUsage();
}

function runScenario(
  name: string,
  setupFn: () => any,
  writeFn: (map: any) => void,
  readFn: (map: any) => void,
) {
  if (global.gc) global.gc();
  const startMem = getMemory();

  // Setup
  const map = setupFn();

  // Write Phase
  const startWrite = performance.now();
  writeFn(map);
  const endWrite = performance.now();

  // Memory Check (Peak)
  const midMem = getMemory();

  // Read Phase
  const startRead = performance.now();
  readFn(map);
  const endRead = performance.now();

  // Cleanup to measure "leaks" or just to be clean
  // (Optional, not measuring post-gc here)

  return {
    writeTime: endWrite - startWrite,
    readTime: endRead - startRead,
    heap: midMem.heapUsed - startMem.heapUsed,
    rss: midMem.rss - startMem.rss,
  };
}

async function benchmarkSuite() {
  console.log(`\n=== RogueMap vs Native Map Benchmark Suite ===`);
  console.log(`Items: ${ITERATIONS}\n`);

  // --- Scenario 1: Small Objects (String -> Number) ---
  console.log(`[Scenario 1: Small Objects (String -> Number)]`);

  const s1_native = runScenario(
    "Native Map",
    () => new Map<string, number>(),
    (map) => {
      for (let i = 0; i < ITERATIONS; i++) map.set(`key${i}`, i);
    },
    (map) => {
      for (let i = 0; i < ITERATIONS; i++) map.get(`key${i}`);
    },
  );

  const s1_rogue = runScenario(
    "RogueMap",
    () =>
      new RogueMap<string, number>({
        capacity: ITERATIONS * 1.5,
        initialMemory: 64 * 1024 * 1024, // Optimized to avoid resizing during benchmark
        keyCodec: StringCodec,
        valueCodec: Int32Codec,
      }),
    (map) => {
      for (let i = 0; i < ITERATIONS; i++) map.set(`key${i}`, i);
    },
    (map) => {
      for (let i = 0; i < ITERATIONS; i++) map.get(`key${i}`);
    },
  );

  printComparison(s1_native, s1_rogue);

  // --- Scenario 2: Large Objects (String -> JSON Object) ---
  console.log(`\n[Scenario 2: Large Objects (String -> { nested: ... })]`);

  const s2_native = runScenario(
    "Native Map",
    () => new Map<string, any>(),
    (map) => {
      for (let i = 0; i < ITERATIONS; i++) {
        map.set(`key${i}`, { id: i, name: "Test", data: "data" });
      }
    },
    (map) => {
      for (let i = 0; i < ITERATIONS; i++) map.get(`key${i}`);
    },
  );

  const s2_rogue = runScenario(
    "RogueMap",
    () =>
      new RogueMap<string, any>({
        capacity: ITERATIONS * 1.5,
        initialMemory: 128 * 1024 * 1024,
        keyCodec: StringCodec,
        valueCodec: JSONCodec,
      }),
    (map) => {
      const obj = { id: 1, name: "Test", data: "data" };
      for (let i = 0; i < ITERATIONS; i++) {
        obj.id = i;
        map.set(`key${i}`, obj);
      }
    },
    (map) => {
      for (let i = 0; i < ITERATIONS; i++) map.get(`key${i}`);
    },
  );

  printComparison(s2_native, s2_rogue);

  // --- Scenario 3: Mixed Workload (Random Get/Set) ---
  // For mixed, we just treat it as "Write Time" for simplicity in reporting, or add a custom field.
  // Let's skip S3 in this refined suite to keep it clean for the user report,
  // or implement it properly if needed. S1 and S2 are the most important for "Map replacement".
}

function printComparison(native: any, rogue: any) {
  console.log(`| Metric | Native Map | RogueMap | Diff |`);
  console.log(`|---|---|---|---|`);
  console.log(
    `| Write Time | ${native.writeTime.toFixed(0)}ms | ${rogue.writeTime.toFixed(0)}ms | ${getDiff(native.writeTime, rogue.writeTime)} |`,
  );
  console.log(
    `| Read Time  | ${native.readTime.toFixed(0)}ms | ${rogue.readTime.toFixed(0)}ms | ${getDiff(native.readTime, rogue.readTime)} |`,
  );
  console.log(
    `| Heap Used  | ${formatBytes(native.heap)} | ${formatBytes(rogue.heap)} | ${getDiff(native.heap, rogue.heap, true)} |`,
  );
  console.log(
    `| RSS (Total)| ${formatBytes(native.rss)} | ${formatBytes(rogue.rss)} | ${getDiff(native.rss, rogue.rss, true)} |`,
  );
}

function getDiff(a: number, b: number, lowerIsBetter = true) {
  const diff = ((b - a) / a) * 100;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(0)}%`;
}

if (!global.gc) {
  console.error("Run with node --expose-gc --import tsx benchmark_suite.ts");
} else {
  benchmarkSuite().catch(console.error);
}
