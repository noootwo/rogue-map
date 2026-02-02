import { Codec } from "./interfaces";
import { Buffer } from "./internal/buffer";

/**
 * String Codec: Encodes strings as UTF-8.
 * Variable length.
 */
export const StringCodec: Codec<string> = {
  encode(value: string, buffer: Buffer, offset: number): number {
    return buffer.write(value, offset);
  },
  decode(buffer: Buffer, offset: number, length: number = 0): string {
    return buffer.toString("utf8", offset, offset + length);
  },
  byteLength(value: string): number {
    return Buffer.byteLength(value);
  },
  fixedLength: undefined,
};

/**
 * UCS2 String Codec: Encodes strings as UTF-16LE (UCS-2).
 * Space efficient for CJK, but doubles size for ASCII.
 * Extremely fast encoding/decoding (no transcoding needed).
 */
export const UCS2StringCodec: Codec<string> = {
  encode(value: string, buffer: Buffer, offset: number): number {
    return buffer.write(value, offset, "ucs2");
  },
  decode(buffer: Buffer, offset: number, length: number = 0): string {
    return buffer.toString("ucs2", offset, offset + length);
  },
  byteLength(value: string): number {
    return value.length * 2;
  },
  fixedLength: undefined,
};

/**
 * Int32 Codec: Encodes numbers as 32-bit integers.
 * Fixed length: 4 bytes.
 */
export const Int32Codec: Codec<number> = {
  encode(value: number, buffer: Buffer, offset: number): number {
    return buffer.writeInt32LE(value, offset);
  },
  decode(buffer: Buffer, offset: number): number {
    return buffer.readInt32LE(offset);
  },
  byteLength(): number {
    return 4;
  },
  fixedLength: 4,
};

/**
 * Float64 Codec: Encodes numbers as 64-bit doubles.
 * Fixed length: 8 bytes.
 */
export const Float64Codec: Codec<number> = {
  encode(value: number, buffer: Buffer, offset: number): number {
    return buffer.writeDoubleLE(value, offset);
  },
  decode(buffer: Buffer, offset: number): number {
    return buffer.readDoubleLE(offset);
  },
  byteLength(): number {
    return 8;
  },
  fixedLength: 8,
};

/**
 * JSON Codec: Encodes values as JSON strings.
 * Variable length.
 */
export const JSONCodec: Codec<any> = {
  encode(value: any, buffer: Buffer, offset: number): number {
    const str = JSON.stringify(value);
    return buffer.write(str, offset);
  },
  decode(buffer: Buffer, offset: number, length: number = 0): any {
    const str = buffer.toString("utf8", offset, offset + length);
    return JSON.parse(str);
  },
  byteLength(value: any): number {
    return Buffer.byteLength(JSON.stringify(value));
  },
  fixedLength: undefined,
};

/**
 * Boolean Codec: Encodes booleans as 1 byte (0 or 1).
 * Fixed length: 1 byte.
 */
export const BooleanCodec: Codec<boolean> = {
  encode(value: boolean, buffer: Buffer, offset: number): number {
    return buffer.writeUInt8(value ? 1 : 0, offset);
  },
  decode(buffer: Buffer, offset: number): boolean {
    return buffer.readUInt8(offset) === 1;
  },
  byteLength(): number {
    return 1;
  },
  fixedLength: 1,
};

/**
 * BigInt64 Codec: Encodes bigints as 64-bit integers.
 * Fixed length: 8 bytes.
 */
export const BigInt64Codec: Codec<bigint> = {
  encode(value: bigint, buffer: Buffer, offset: number): number {
    return buffer.writeBigInt64LE(value, offset);
  },
  decode(buffer: Buffer, offset: number): bigint {
    return buffer.readBigInt64LE(offset);
  },
  byteLength(): number {
    return 8;
  },
  fixedLength: 8,
};

/**
 * Date Codec: Encodes dates as 64-bit doubles (timestamp).
 * Fixed length: 8 bytes.
 */
export const DateCodec: Codec<Date> = {
  encode(value: Date, buffer: Buffer, offset: number): number {
    return buffer.writeDoubleLE(value.getTime(), offset);
  },
  decode(buffer: Buffer, offset: number): Date {
    return new Date(buffer.readDoubleLE(offset));
  },
  byteLength(): number {
    return 8;
  },
  fixedLength: 8,
};

/**
 * Buffer Codec: Encodes Buffers directly.
 * Variable length.
 */
export const BufferCodec: Codec<Buffer> = {
  encode(value: Buffer, buffer: Buffer, offset: number): number {
    return value.copy(buffer, offset);
  },
  decode(buffer: Buffer, offset: number, length: number = 0): Buffer {
    // Return a copy to ensure safety and zero-allocation source isolation
    // Since this is BufferCodec, the user expects a Buffer instance.
    // If we return a subarray (view), it might keep the large page buffer alive.
    // So we allocUnsafe + copy here.
    const res = Buffer.allocUnsafe(length);
    buffer.copy(res, 0, offset, offset + length);
    return res;
  },
  byteLength(value: Buffer): number {
    return value.length;
  },
  fixedLength: undefined,
};

/**
 * Any Codec: Encodes any type using a prefix byte to identify the type.
 * Supports: Null, Undefined, Boolean, Int32, Float64, String, Date, Buffer, BigInt, JSON.
 */
export const AnyCodec: Codec<any> = {
  encode(value: any, buffer: Buffer, offset: number): number {
    // Prefix byte for type:
    // 0: Null/Undefined
    // 1: Boolean (1 byte)
    // 2: Int32 (4 bytes)
    // 3: Float64 (8 bytes)
    // 4: String (Var)
    // 5: Date (8 bytes)
    // 6: JSON (Var)
    // 7: Buffer (Var)
    // 8: BigInt (8 bytes)

    if (value === null || value === undefined) {
      buffer.writeUInt8(0, offset);
      return 1;
    }

    if (typeof value === "boolean") {
      buffer.writeUInt8(1, offset);
      buffer.writeUInt8(value ? 1 : 0, offset + 1);
      return 2;
    }

    if (typeof value === "number") {
      if (
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647
      ) {
        buffer.writeUInt8(2, offset);
        buffer.writeInt32LE(value, offset + 1);
        return 5;
      }
      buffer.writeUInt8(3, offset);
      buffer.writeDoubleLE(value, offset + 1);
      return 9;
    }

    if (typeof value === "string") {
      buffer.writeUInt8(4, offset);
      const len = buffer.write(value, offset + 1);
      return 1 + len;
    }

    if (typeof value === "bigint") {
      buffer.writeUInt8(8, offset);
      buffer.writeBigInt64LE(value, offset + 1);
      return 9;
    }

    if (value instanceof Date) {
      buffer.writeUInt8(5, offset);
      buffer.writeDoubleLE(value.getTime(), offset + 1);
      return 9;
    }

    if (Buffer.isBuffer(value)) {
      buffer.writeUInt8(7, offset);
      value.copy(buffer, offset + 1);
      return 1 + value.length;
    }

    // Fallback to JSON
    buffer.writeUInt8(6, offset);
    const str = JSON.stringify(value);
    const len = buffer.write(str, offset + 1);
    return 1 + len;
  },

  decode(buffer: Buffer, offset: number, length: number = 0): any {
    const type = buffer.readUInt8(offset);
    const dataOffset = offset + 1;
    const dataLen = length - 1;

    switch (type) {
      case 0:
        return null;
      case 1:
        return buffer.readUInt8(dataOffset) === 1;
      case 2:
        return buffer.readInt32LE(dataOffset);
      case 3:
        return buffer.readDoubleLE(dataOffset);
      case 4:
        return buffer.toString("utf8", dataOffset, dataOffset + dataLen);
      case 5:
        return new Date(buffer.readDoubleLE(dataOffset));
      case 6:
        return JSON.parse(
          buffer.toString("utf8", dataOffset, dataOffset + dataLen),
        );
      case 7: {
        const res = Buffer.allocUnsafe(dataLen);
        buffer.copy(res, 0, dataOffset, dataOffset + dataLen);
        return res;
      }
      case 8:
        return buffer.readBigInt64LE(dataOffset);
      default:
        return undefined;
    }
  },

  byteLength(value: any): number {
    if (value === null || value === undefined) return 1;
    if (typeof value === "boolean") return 2;
    if (typeof value === "number") {
      if (
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647
      )
        return 5;
      return 9;
    }
    if (typeof value === "string") return 1 + Buffer.byteLength(value);
    if (typeof value === "bigint") return 9;
    if (value instanceof Date) return 9;
    if (Buffer.isBuffer(value)) return 1 + value.length;
    return 1 + Buffer.byteLength(JSON.stringify(value));
  },

  fixedLength: undefined,
};
