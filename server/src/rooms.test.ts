import {
  createRoom,
  joinRoom,
  leaveRoom,
  deleteRoom,
  getRoom,
  sweepExpired,
  validateUsername,
  isUsernameTaken,
  markRoomCompleted,
  MAX_ACTIVE_PLAYERS,
  MAX_SPECTATORS,
  MAX_CONNECTIONS,
  ABANDONED_MS,
  COMPLETED_MS,
  RoomError,
} from "./rooms.js";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log("  ok -", msg);
  } else {
    console.log("  FAIL -", msg);
    failed++;
  }
}

console.log("Testing Username Validation...");
try {
  assert(validateUsername("Alice") === "Alice", "valid username Alice");
  assert(validateUsername("  Bob_123  ") === "Bob_123", "trims and accepts alphanumeric + underscore");
  assert(validateUsername("Cool Player") === "Cool Player", "accepts spaces");
} catch (e) {
  assert(false, `Unexpected error in valid usernames: ${e}`);
}

try {
  validateUsername("ab");
  assert(false, "should reject <3 chars");
} catch (e) {
  assert(e instanceof RoomError && e.code === "INVALID_USERNAME", "rejects short username");
}

try {
  validateUsername("a".repeat(25));
  assert(false, "should reject >20 chars");
} catch (e) {
  assert(e instanceof RoomError && e.code === "INVALID_USERNAME", "rejects long username");
}

try {
  validateUsername("<script>alert()</script>");
  assert(false, "should reject invalid characters");
} catch (e) {
  assert(e instanceof RoomError && e.code === "INVALID_USERNAME", "rejects HTML/special chars");
}

console.log("Testing Room Creation and Initial State...");
const room1 = createRoom("My Room", "socket_1", "Alice", "player");
assert(room1.name === "My Room", "sets room name");
assert(room1.ownerId === "socket_1", "assigns creator as owner");
assert(room1.players.size === 1, "room has 1 player");
assert(room1.abandonedAt === null, "room is not abandoned on creation");
assert(room1.completedAt === null, "room is not completed on creation");

console.log("Testing Username Uniqueness in Room...");
assert(isUsernameTaken(room1, "alice"), "case-insensitive match for existing username");
assert(!isUsernameTaken(room1, "Bob"), "Bob is available");
try {
  joinRoom(room1.id, "socket_2", "Alice");
  assert(false, "should reject duplicate username");
} catch (e) {
  assert(e instanceof RoomError && e.code === "USERNAME_TAKEN", "rejects duplicate username");
}

console.log("Testing Room Roles and Capacity...");
const capRoom = createRoom("Cap Room", "p_0", "Player_0", "player");
for (let i = 1; i < MAX_ACTIVE_PLAYERS; i++) {
  joinRoom(capRoom.id, `p_${i}`, `Player_${i}`, "player");
}
assert(capRoom.players.size === 15, "15 active players in room");

try {
  joinRoom(capRoom.id, "p_15", "Player_15", "player");
  assert(false, "should reject 16th active player");
} catch (e) {
  assert(e instanceof RoomError && e.code === "ACTIVE_PLAYERS_FULL", "enforces 15 active player limit");
}

// Should still allow joining as spectator
joinRoom(capRoom.id, "s_0", "Spectator_0", "spectator");
assert(capRoom.players.size === 16, "spectator joined successfully");

for (let i = 1; i < MAX_SPECTATORS; i++) {
  joinRoom(capRoom.id, `s_${i}`, `Spectator_${i}`, "spectator");
}
assert(capRoom.players.size === 30, "30 total connections (15 active + 15 spectators)");

try {
  joinRoom(capRoom.id, "s_15", "Spectator_15", "spectator");
  assert(false, "should reject 16th spectator / 31st connection");
} catch (e) {
  assert(e instanceof RoomError && (e.code === "ROOM_FULL" || e.code === "SPECTATORS_FULL"), "enforces max connection limit");
}

console.log("Testing Owner Transfer on Leave...");
const ownerRoom = createRoom("Owner Room", "owner_sock", "OwnerAlice", "player");
joinRoom(ownerRoom.id, "guest_sock", "GuestBob", "player");
joinRoom(ownerRoom.id, "spec_sock", "SpecCharlie", "spectator");

leaveRoom(ownerRoom.id, "owner_sock");
assert(ownerRoom.players.size === 2, "owner left, 2 players remain");
assert(ownerRoom.ownerId === "guest_sock", "ownership transferred to next active player GuestBob");
assert(ownerRoom.abandonedAt === null, "room is not marked abandoned while players remain");

leaveRoom(ownerRoom.id, "guest_sock");
assert(ownerRoom.ownerId === "spec_sock", "ownership transferred to remaining spectator SpecCharlie");
assert(ownerRoom.abandonedAt === null, "room still not abandoned");

console.log("Testing Abandonment Lifecycle...");
const baseTime = 1000000;
leaveRoom(ownerRoom.id, "spec_sock", baseTime);
assert(ownerRoom.players.size === 0, "all players left");
assert(ownerRoom.abandonedAt === baseTime, "room marked abandoned at baseTime when last player leaves");

// Rejoining before 24h un-abandons the room
const revivedRoom = joinRoom(ownerRoom.id, "rejoin_sock", "NewHero", "player", baseTime + 1000);
assert(revivedRoom.abandonedAt === null, "room un-abandoned after player rejoins");
assert(revivedRoom.ownerId === "rejoin_sock", "rejoining player becomes new owner");
assert(revivedRoom.players.size === 1, "revived room has 1 player");

// Test expiration after 24h
leaveRoom(revivedRoom.id, "rejoin_sock", baseTime);
assert(revivedRoom.abandonedAt === baseTime, "room abandoned again");

try {
  joinRoom(revivedRoom.id, "late_sock", "LateGuy", "player", baseTime + ABANDONED_MS + 1000);
  assert(false, "should reject joining expired abandoned room");
} catch (e) {
  assert(e instanceof RoomError && e.code === "ROOM_ABANDONED", "rejects joining abandoned room after 24h");
}

console.log("Testing Sweeping...");
const sweepRoom1 = createRoom("Abandoned Sweep", "sw1", "User1");
leaveRoom(sweepRoom1.id, "sw1", baseTime);

const sweepRoom2 = createRoom("Completed Sweep", "sw2", "User2");
markRoomCompleted(sweepRoom2.id, baseTime);

const sweepRoom3 = createRoom("Active Room", "sw3", "User3");

const expiredIds = sweepExpired(baseTime + ABANDONED_MS + 1000);
assert(expiredIds.includes(sweepRoom1.id), "sweeps abandoned room after 24h");
assert(!expiredIds.includes(sweepRoom2.id), "does not sweep completed room before 48h");
assert(!expiredIds.includes(sweepRoom3.id), "does not sweep active room");

const expiredIds2 = sweepExpired(baseTime + COMPLETED_MS + 1000);
assert(expiredIds2.includes(sweepRoom2.id), "sweeps completed room after 48h");
assert(getRoom(sweepRoom3.id) !== undefined, "active room persists");

console.log(failed ? `\nRESULT: FAIL (${failed} errors)` : "\nRESULT: ALL ROOM TESTS PASSED");
process.exit(failed ? 1 : 0);
