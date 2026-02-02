
# Browser Benchmark

This directory contains a browser-based benchmark for RogueMap.

## How to run

```bash
npm run bench:browser
```

This will start a Vite dev server. Open the displayed URL (e.g., `http://localhost:5173`) in your browser.
Click "Run Benchmark" to see the results.

## Environment

The benchmark uses a polyfilled `Buffer` (via CDN) and a mock `process` object to simulate a Node.js-like environment within the browser. RogueMap's `persistence` is set to `memory` (or you can test `indexeddb` by modifying `runner.ts`) to avoid file system errors.
