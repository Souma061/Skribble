/**
 * Binary Drawing Protocol Codec (Server)
 *
 * Memory Layout per chunk:
 * [0..1] uint16: strokeSeq (1, 2, 3...)
 * [2..3] uint16: pointCount (N)
 * [4..N] pairs of uint16: x, y quantized to [0..65535] (0.0 to 1.0)
 */

export interface DecodedChunk {
  strokeSeq: number;
  points: { x: number; y: number }[];
}

export const MAX_BINARY_POINTS_PER_CHUNK = 500;

const EMPTY_CHUNK: DecodedChunk = { strokeSeq: 0, points: [] };

/**
 * Decodes a raw Node.js Buffer, ArrayBuffer, or Uint8Array into normalized coordinates
 */
export function decodeBinaryChunk(data: Buffer | ArrayBuffer | Uint8Array): DecodedChunk {
  let view: DataView;
  let byteLength: number;

  if (Buffer.isBuffer(data)) {
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    byteLength = data.byteLength;
  } else if (data instanceof Uint8Array) {
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    byteLength = data.byteLength;
  } else {
    view = new DataView(data);
    byteLength = data.byteLength;
  }

  if (byteLength < 4) return EMPTY_CHUNK;

  const strokeSeq = view.getUint16(0, true);
  const count = view.getUint16(2, true);
  const requiredByteLength = 4 + count * 4;
  if (count === 0 || count > MAX_BINARY_POINTS_PER_CHUNK || requiredByteLength > byteLength) {
    return EMPTY_CHUNK;
  }

  const points: { x: number; y: number }[] = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const rawX = view.getUint16(offset, true) / 65535;
    const rawY = view.getUint16(offset + 2, true) / 65535;
    points.push({
      x: Math.round(rawX * 10000) / 10000,
      y: Math.round(rawY * 10000) / 10000,
    });
    offset += 4;
  }

  return { strokeSeq, points };
}

/**
 * Checks if incoming socket payload is binary (Buffer, ArrayBuffer, or Uint8Array)
 */
export function isBinaryPayload(payload: unknown): payload is Buffer | ArrayBuffer | Uint8Array {
  return (
    Buffer.isBuffer(payload) || payload instanceof ArrayBuffer || payload instanceof Uint8Array
  );
}
