import { RogueMap } from "../src/RogueMap";
import { Int32Codec, StringCodec } from "../src/codecs";

const SCALES = [10_000, 100_000, 1_000_000, 10_000_000];

function formatBytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function getMemory() {
  if (global.gc) global.gc();
  return process.memoryUsage();
}

function runScenario(
  name: string,
  iterations: number,
  setupFn: () => any,
  writeFn: (map: any, iterations: number) => void,
  readFn: (map: any, iterations: number) => void,
) {
  if (global.gc) global.gc();
  const startMem = getMemory();

  // Setup
  let map;
  try {
    map = setupFn();
  } catch (e) {
    return { error: "Setup Failed" };
  }

  // Write Phase
  const startWrite = performance.now();
  try {
    writeFn(map, iterations);
  } catch (e) {
    return { error: "Write Failed/OOM" };
  }
  const endWrite = performance.now();

  // Memory Check (Peak)
  const midMem = getMemory();

  // Read Phase
  const startRead = performance.now();
  try {
    readFn(map, iterations);
  } catch (e) {
    return { error: "Read Failed" };
  }
  const endRead = performance.now();

  return {
    writeTime: endWrite - startWrite,
    readTime: endRead - startRead,
    heap: midMem.heapUsed - startMem.heapUsed,
    rss: midMem.rss - startMem.rss,
  };
}

async function benchmarkComparison() {
  console.log(`# Performance Comparison: Object vs Map vs RogueMap\n`);

  // Warmup to stabilize V8 Heap metrics for the first real run
  console.log("Warming up...");
  runScenario(
    "Warmup",
    5000,
    () => new RogueMap({ capacity: 5000, initialMemory: 1024 * 1024 }),
    (map, iter) => {
      for (let i = 0; i < iter; i++) map.set("k" + i, i);
    },
    (map, iter) => {
      for (let i = 0; i < iter; i++) map.get("k" + i);
    },
  );
  // Also warmup Map/Object slightly
  runScenario(
    "WarmupObj",
    1000,
    () => ({}),
    (o, i) => (o[i] = i),
    (o, i) => o[i],
  );
  runScenario(
    "WarmupMap",
    1000,
    () => new Map(),
    (m, i) => m.set(i, i),
    (m, i) => m.get(i),
  );

  for (const iterations of SCALES) {
    console.log(`\n## Scale: ${iterations.toLocaleString()} Items\n`);

    const results: any[] = [];

    // 1. Native Object
    if (iterations <= 1_000_000) {
      const objRes = runScenario(
        "Object",
        iterations,
        () => ({}),
        (obj, iter) => {
          for (let i = 0; i < iter; i++) obj[`key${i}`] = i;
        },
        (obj, iter) => {
          for (let i = 0; i < iter; i++) {
            const _ = obj[`key${i}`];
          }
        },
      );
      results.push({ name: "Object", ...objRes });
    } else {
      results.push({ name: "Object", error: "Too Slow / OOM" });
    }

    // 2. Native Map
    if (iterations <= 10_000_000) {
      // Map usually survives 10M but might OOM on smaller heap machines.
      // We'll try.
      try {
        const mapRes = runScenario(
          "Map",
          iterations,
          () => new Map(),
          (map, iter) => {
            for (let i = 0; i < iter; i++) map.set(`key${i}`, i);
          },
          (map, iter) => {
            for (let i = 0; i < iter; i++) map.get(`key${i}`);
          },
        );
        results.push({ name: "Map", ...mapRes });
      } catch (e) {
        results.push({ name: "Map", error: "OOM" });
      }
    } else {
      results.push({ name: "Map", error: "OOM" });
    }

    // 3. RogueMap
    const rogueRes = runScenario(
      "RogueMap",
      iterations,
      () =>
        new RogueMap({
          capacity: iterations * 1.5,
          initialMemory: iterations * 40,
          keyCodec: StringCodec,
          valueCodec: Int32Codec,
        }),
      (map, iter) => {
        for (let i = 0; i < iter; i++) map.set(`key${i}`, i);
      },
      (map, iter) => {
        for (let i = 0; i < iter; i++) map.get(`key${i}`);
      },
    );
    results.push({ name: "RogueMap", ...rogueRes });

    // Print Table
    console.log(`| Type | Write Time | Read Time | Heap Used | RSS |`);
    console.log(`|---|---|---|---|---|`);

    for (const res of results) {
      if (res.error) {
        console.log(`| ${res.name} | ${res.error} | ${res.error} | - | - |`);
      } else {
        console.log(
          `| ${res.name} | ${res.writeTime.toFixed(0)}ms | ${res.readTime.toFixed(0)}ms | ${formatBytes(res.heap)} | ${formatBytes(res.rss)} |`,
        );
      }
    }
  }
}

if (!global.gc) {
  console.error(
    "Run with node --expose-gc --import tsx benchmarks/benchmark_comparison.ts",
  );
} else {
  benchmarkComparison().catch(console.error);
}
