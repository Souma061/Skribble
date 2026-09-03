/**
 * Binary Drawing Protocol Codec (Client)
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

const MAX_BINARY_POINTS_PER_CHUNK = 500;
const EMPTY_CHUNK: DecodedChunk = { strokeSeq: 0, points: [] };

/**
 * Packs stroke sequence ID and normalized float points into an ArrayBuffer
 */
export function encodeBinaryChunk(
  strokeSeq: number,
  points: { x: number; y: number }[],
): ArrayBuffer {
  const buffer = new ArrayBuffer(4 + points.length * 4);
  const view = new DataView(buffer);

  view.setUint16(0, strokeSeq, true); // Little-endian
  view.setUint16(2, points.length, true);

  let offset = 4;
  for (let i = 0; i < points.length; i++) {
    const clampedX = Math.max(0, Math.min(1, points[i].x));
    const clampedY = Math.max(0, Math.min(1, points[i].y));
    view.setUint16(offset, Math.round(clampedX * 65535), true);
    view.setUint16(offset + 2, Math.round(clampedY * 65535), true);
    offset += 4;
  }

  return buffer;
}

/**
 * Unpacks an ArrayBuffer or Uint8Array back into normalized float coordinates
 */
export function decodeBinaryChunk(data: ArrayBuffer | Uint8Array): DecodedChunk {
  const byteLength = data.byteLength;
  if (byteLength < 4) return EMPTY_CHUNK;

  const view =
    data instanceof Uint8Array
      ? new DataView(data.buffer, data.byteOffset, data.byteLength)
      : new DataView(data);

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
 * Helper to determine if an incoming payload is binary
 */
export function isBinaryPayload(payload: unknown): payload is ArrayBuffer | Uint8Array {
  return payload instanceof ArrayBuffer || payload instanceof Uint8Array;
}
