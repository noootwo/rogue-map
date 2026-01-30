/**
 * Interface for custom data encoders/decoders (Codecs).
 * RogueMap uses codecs to serialize keys and values into the underlying Buffer.
 */
export interface Codec<T> {
  /**
   * Encodes the value into the buffer at the given offset.
   * Returns the number of bytes written.
   */
  encode(value: T, buffer: Buffer, offset: number): number;

  /**
   * Decodes the value from the buffer at the given offset.
   * Returns the decoded value and the number of bytes read (implied or separate).
   * For simplicity, we might need a way to know the length if not fixed.
   */
  decode(buffer: Buffer, offset: number, length?: number): T;

  /**
   * Returns the byte length required to store the value.
   */
  byteLength(value: T): number;

  /**
   * If the codec produces a fixed length, return it. Otherwise return null or undefined.
   */
  fixedLength?: number;
}
