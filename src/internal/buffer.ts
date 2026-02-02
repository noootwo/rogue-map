
import { Buffer as NodeBuffer } from "buffer";

/**
 * Internal Buffer Abstraction.
 * In Node.js, this uses the native global Buffer (which is faster and full-featured).
 * In Browsers, this uses the 'buffer' npm package (polyfill).
 */

// Detect if we are in Node.js environment with native Buffer
const isNode =
  typeof process !== "undefined" &&
  process.versions &&
  process.versions.node &&
  typeof global !== "undefined" &&
  global.Buffer;

let BufferImpl: typeof NodeBuffer;

if (isNode) {
  // Use native global Buffer in Node.js
  BufferImpl = global.Buffer as unknown as typeof NodeBuffer;
} else {
  // Use polyfill in Browser
  BufferImpl = NodeBuffer;

  // Patch allocUnsafe if missing (common in browser builds)
  if (!BufferImpl.allocUnsafe) {
    BufferImpl.allocUnsafe = BufferImpl.alloc;
  }
}

export const Buffer = BufferImpl;
