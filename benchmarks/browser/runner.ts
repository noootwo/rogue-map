import { RogueMap } from "../../src/RogueMap";
import { StringCodec, Int32Codec } from "../../src/codecs";

const logEl = document.getElementById("output")!;
const btn = document.getElementById("run-btn")!;

function log(
  msg: string,
  type: "info" | "header" | "key" | "val" | "success" | "error" = "info",
) {
  const span = document.createElement("div");
  if (type === "header") span.className = "log-header";
  else if (type === "success") span.className = "log-success";
  else if (type === "error") span.className = "log-error";

  span.textContent = msg;
  logEl.appendChild(span);
  console.log(msg);

  // Auto scroll
  window.scrollTo(0, document.body.scrollHeight);
}

function clearLog() {
  logEl.innerHTML = "";
}

function formatBytes(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

async function runBenchmark() {
  clearLog();
  log("Running Benchmark Suite...", "header");
  btn.setAttribute("disabled", "true");

  try {
    // --- 1. Basic Performance (100k) ---
    const COUNT_100K = 100_000;
    log(
      `1. Basic Performance (${COUNT_100K.toLocaleString()} items)`,
      "header",
    );

    const map1 = new RogueMap({
      capacity: COUNT_100K * 1.5,
      initialMemory: COUNT_100K * 40,
      persistence: { type: "memory", path: "mem1" },
    });

    const startWrite1 = performance.now();
    for (let i = 0; i < COUNT_100K; i++) map1.set("k" + i, i);
    const endWrite1 = performance.now();
    log(`Write: ${(endWrite1 - startWrite1).toFixed(2)}ms`);

    const startRead1 = performance.now();
    for (let i = 0; i < COUNT_100K; i++) map1.get("k" + i);
    const endRead1 = performance.now();
    log(`Read: ${(endRead1 - startRead1).toFixed(2)}ms`);

    // --- 2. High Scale (1M) ---
    const COUNT_1M = 1_000_000;
    log(`2. High Scale (${COUNT_1M.toLocaleString()} items)`, "header");

    const map2 = new RogueMap({
      capacity: COUNT_1M * 1.5,
      initialMemory: COUNT_1M * 40,
      persistence: { type: "memory", path: "mem2" },
    });

    const startWrite2 = performance.now();
    for (let i = 0; i < COUNT_1M; i++) map2.set("k" + i, i);
    const endWrite2 = performance.now();
    log(`Write: ${(endWrite2 - startWrite2).toFixed(2)}ms`);

    const startRead2 = performance.now();
    for (let i = 0; i < COUNT_1M; i++) map2.get("k" + i);
    const endRead2 = performance.now();
    log(`Read: ${(endRead2 - startRead2).toFixed(2)}ms`);

    // --- 3. Persistence (IndexedDB) ---
    log(`3. Persistence (IndexedDB - 10k items)`, "header");
    const COUNT_PERSIST = 10_000;
    // Note: 'path' in options is used as key for save/load
    const DB_KEY = "bench_test_db";

    const mapP = new RogueMap({
      capacity: COUNT_PERSIST * 1.5,
      persistence: { type: "indexeddb", path: DB_KEY },
    });

    log("Filling Map...");
    for (let i = 0; i < COUNT_PERSIST; i++) mapP.set("p" + i, i);

    log("Saving to IndexedDB...");
    const startSave = performance.now();
    await mapP.save(); // Save using configured path
    const endSave = performance.now();
    log(`Save Time: ${(endSave - startSave).toFixed(2)}ms`, "success");

    log("Clearing Map in memory...");
    mapP.clear();
    log(`Size after clear: ${mapP.size}`);

    log("Loading from IndexedDB...");
    const startLoad = performance.now();
    await mapP.init(); // Load using configured path
    const endLoad = performance.now();
    log(`Load Time: ${(endLoad - startLoad).toFixed(2)}ms`, "success");
    log(`Size after load: ${mapP.size}`);

    // Verify
    const val = mapP.get("p0");
    log(
      `Verify key 'p0': ${val} (Expected 0)`,
      val === 0 ? "success" : "error",
    );

    // --- 4. Iteration Performance ---
    log(`4. Iteration Performance (1M items)`, "header");
    const startIter = performance.now();
    let count = 0;
    for (const _ of map2.values()) {
      count++;
    }
    const endIter = performance.now();
    log(`Iterate Values: ${(endIter - startIter).toFixed(2)}ms`);

    log("Done!", "success");
  } catch (err: any) {
    log(`Error: ${err.message}`, "error");
    console.error(err);
  } finally {
    btn.removeAttribute("disabled");
  }
}

btn.addEventListener("click", runBenchmark);
