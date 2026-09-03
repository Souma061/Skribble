import {
    decodeBinaryChunk,
    isBinaryPayload,
    MAX_BINARY_POINTS_PER_CHUNK,
} from "./binaryDrawing.js";

let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log("  ok -", message);
  } else {
    console.log("  FAIL -", message);
    failed++;
  }
}

console.log("Testing Binary Drawing Codec...");

assert(!isBinaryPayload({ byteLength: 8 }), "rejects plain objects with byteLength");
assert(decodeBinaryChunk(Buffer.alloc(3)).points.length === 0, "rejects truncated headers");

const truncatedPoints = Buffer.alloc(8);
truncatedPoints.writeUInt16LE(1, 0);
truncatedPoints.writeUInt16LE(2, 2);
assert(decodeBinaryChunk(truncatedPoints).points.length === 0, "rejects truncated point data");

const oversized = Buffer.alloc(4);
oversized.writeUInt16LE(1, 0);
oversized.writeUInt16LE(MAX_BINARY_POINTS_PER_CHUNK + 1, 2);
assert(decodeBinaryChunk(oversized).points.length === 0, "rejects excessive point counts");

const valid = Buffer.alloc(12);
valid.writeUInt16LE(7, 0);
valid.writeUInt16LE(2, 2);
valid.writeUInt16LE(0, 4);
valid.writeUInt16LE(65535, 6);
valid.writeUInt16LE(32768, 8);
valid.writeUInt16LE(16384, 10);
const decoded = decodeBinaryChunk(valid);
assert(decoded.strokeSeq === 7, "decodes the stroke sequence");
assert(decoded.points.length === 2, "decodes the declared points");
assert(decoded.points[0]?.x === 0 && decoded.points[0]?.y === 1, "normalizes coordinates");

const pooled = Buffer.alloc(20);
valid.copy(pooled, 4);
const slicedView = pooled.subarray(4, 16);
const slicedDecoded = decodeBinaryChunk(slicedView);
assert(
  slicedDecoded.strokeSeq === 7 && slicedDecoded.points.length === 2,
  "respects typed-array byte offsets",
);

console.log(failed ? `RESULT: FAIL (${failed})` : "RESULT: PASS");
process.exit(failed ? 1 : 0);
