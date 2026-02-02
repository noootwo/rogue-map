
import { Buffer } from "./internal/buffer";
import { Codec } from "./interfaces";

/**
 * Supported field types for Struct definition.
 */
export type FieldType = 
  | 'int8' | 'uint8' 
  | 'int16' | 'uint16' 
  | 'int32' | 'uint32' 
  | 'float64' | 'double'
  | 'boolean'
  | `string(${number})`; // Fixed length string, e.g., 'string(20)'

/**
 * Schema definition for a Struct.
 */
export type StructSchema = Record<string, FieldType>;

/**
 * Infer TypeScript type from StructSchema.
 */
export type InferStruct<T extends StructSchema> = {
  [K in keyof T]: 
    T[K] extends 'boolean' ? boolean :
    T[K] extends `string(${number})` ? string :
    number;
};

interface FieldMeta {
  name: string;
  type: string;
  offset: number;
  size: number;
  // Codec helpers
  read: (buf: Buffer, offset: number) => any;
  write: (buf: Buffer, offset: number, val: any) => void;
}

/**
 * Creates a Struct Codec for zero-copy access to structured data.
 * 
 * @param schema The structure definition.
 * @returns A Codec that encodes objects into a fixed binary layout and decodes them as lazy views.
 */
export function defineStruct<T extends StructSchema>(schema: T): Codec<InferStruct<T>> {
  const fields: FieldMeta[] = [];
  let currentOffset = 0;

  for (const [name, typeDef] of Object.entries(schema)) {
    let size = 0;
    let read: (b: Buffer, o: number) => any;
    let write: (b: Buffer, o: number, v: any) => void;

    if (typeDef === 'int8') {
      size = 1;
      read = (b, o) => b.readInt8(o);
      write = (b, o, v) => b.writeInt8(v, o);
    } else if (typeDef === 'uint8') {
      size = 1;
      read = (b, o) => b.readUInt8(o);
      write = (b, o, v) => b.writeUInt8(v, o);
    } else if (typeDef === 'int16') {
      size = 2;
      read = (b, o) => b.readInt16LE(o);
      write = (b, o, v) => b.writeInt16LE(v, o);
    } else if (typeDef === 'uint16') {
      size = 2;
      read = (b, o) => b.readUInt16LE(o);
      write = (b, o, v) => b.writeUInt16LE(v, o);
    } else if (typeDef === 'int32') {
      size = 4;
      read = (b, o) => b.readInt32LE(o);
      write = (b, o, v) => b.writeInt32LE(v, o);
    } else if (typeDef === 'uint32') {
      size = 4;
      read = (b, o) => b.readUInt32LE(o);
      write = (b, o, v) => b.writeUInt32LE(v, o);
    } else if (typeDef === 'float64' || typeDef === 'double') {
      size = 8;
      read = (b, o) => b.readDoubleLE(o);
      write = (b, o, v) => b.writeDoubleLE(v, o);
    } else if (typeDef === 'boolean') {
      size = 1;
      read = (b, o) => b.readUInt8(o) !== 0;
      write = (b, o, v) => b.writeUInt8(v ? 1 : 0, o);
    } else if (typeDef.startsWith('string(')) {
      const match = typeDef.match(/string\((\d+)\)/);
      if (!match) throw new Error(`Invalid string type: ${typeDef}`);
      const len = parseInt(match[1], 10);
      size = len;
      // Fixed string: Read zero-padded or full length
      read = (b, o) => {
        // Find null terminator or end
        let end = o + len;
        // Optimization: Don't scan if we assume padded with nulls, 
        // but to be correct standard C-string behavior:
        // Actually Buffer.toString strips nulls? No.
        // We trim nulls manually for better experience.
        const str = b.toString('utf8', o, o + len);
        // Remove trailing nulls
        // eslint-disable-next-line no-control-regex
        return str.replace(/\u0000+$/, '');
      };
      write = (b, o, v) => {
        const str = String(v);
        const written = b.write(str, o, len, 'utf8');
        // Pad remaining with 0
        if (written < len) {
          b.fill(0, o + written, o + len);
        }
      };
    } else {
      throw new Error(`Unsupported field type: ${typeDef}`);
    }

    fields.push({
      name,
      type: typeDef,
      offset: currentOffset,
      size,
      read,
      write
    });

    currentOffset += size;
  }

  const structSize = currentOffset;

  // The Proxy Handler for Lazy Decoding
  const proxyHandler: ProxyHandler<any> = {
    get(target, prop) {
      // target is { buffer, offset }
      if (typeof prop !== 'string') return undefined;
      
      // If user calls toJSON or inspect, we should return full object
      if (prop === 'toJSON') {
        return () => {
          const res: any = {};
          for(const f of fields) {
            res[f.name] = f.read(target.buffer, target.offset + f.offset);
          }
          return res;
        };
      }

      // Find field
      // Optimization: Could use a Map for faster lookup if many fields
      const field = fields.find(f => f.name === prop);
      if (!field) return undefined;

      return field.read(target.buffer, target.offset + field.offset);
    },
    
    // Support writing back to buffer
    set(target, prop, value) {
      if (typeof prop !== 'string') return false;

      const field = fields.find(f => f.name === prop);
      if (!field) return false;

      // In-Place Update: Write directly to buffer
      field.write(target.buffer, target.offset + field.offset, value);
      return true;
    },

    ownKeys() {
        return fields.map(f => f.name);
    },

    getOwnPropertyDescriptor(target, prop) {
        const field = fields.find(f => f.name === prop);
        if (field) {
            return {
                enumerable: true,
                configurable: true,
                // We don't provide value here, standard iterators might fail if we don't?
                // Actually proxy trap for get will handle value access.
            };
        }
        return undefined;
    }
  };

  return {
    encode(value: any, buffer: Buffer, offset: number): number {
      for (const field of fields) {
        const v = value[field.name];
        if (v === undefined) {
            // Fill 0?
            buffer.fill(0, offset + field.offset, offset + field.offset + field.size);
        } else {
            field.write(buffer, offset + field.offset, v);
        }
      }
      return structSize;
    },

    decode(buffer: Buffer, offset: number, length?: number): InferStruct<T> {
      // Return a Proxy wrapping the buffer slice info
      // We pass a lightweight context object
      const context = { buffer, offset };
      return new Proxy(context, proxyHandler);
    },

    byteLength(): number {
      return structSize;
    },

    fixedLength: structSize
  };
}
