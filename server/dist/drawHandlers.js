import { Server, Socket } from "socket.io";
import { getRoom } from "./rooms.js";
const roomDrawHistories = new Map();
export function getRoomStrokes(roomId) {
    return roomDrawHistories.get(roomId) || [];
}
export function clearRoomStrokes(roomId) {
    roomDrawHistories.delete(roomId);
}
function isDrawerAuthorized(roomId, socketId) {
    const room = getRoom(roomId);
    if (!room)
        return false;
    // During an active game round: ONLY the selected drawer can draw
    if (room.game.status === "ACTIVE_ROUND" || room.game.status === "WORD_SELECTION") {
        return room.game.currentDrawerId === socketId;
    }
    // When game is WAITING in the lobby: only the room owner can test draw
    return room.ownerId === socketId;
}
export function registerDrawHandlers(io, socket) {
    // 1. Stroke started
    socket.on("draw:start", (payload) => {
        const roomId = socket.data.roomId;
        if (!roomId || !payload.strokeId || !payload.startPoint)
            return;
        if (!isDrawerAuthorized(roomId, socket.id))
            return;
        if (!roomDrawHistories.has(roomId)) {
            roomDrawHistories.set(roomId, []);
        }
        const strokes = roomDrawHistories.get(roomId);
        strokes.push({
            id: payload.strokeId,
            color: payload.color || "#2E1065",
            size: payload.size || 6,
            points: [payload.startPoint],
        });
        socket.to(roomId).emit("draw:start", payload);
    });
    // 2. Stroke chunk streamed
    socket.on("draw:chunk", (payload) => {
        const roomId = socket.data.roomId;
        if (!roomId || !payload.strokeId || !Array.isArray(payload.points) || payload.points.length === 0) {
            return;
        }
        if (!isDrawerAuthorized(roomId, socket.id))
            return;
        const strokes = roomDrawHistories.get(roomId);
        if (strokes) {
            const currentStroke = strokes.find((s) => s.id === payload.strokeId);
            if (currentStroke) {
                currentStroke.points.push(...payload.points);
            }
        }
        socket.to(roomId).emit("draw:chunk", payload);
    });
    // 3. Clear canvas
    socket.on("draw:clear", () => {
        const roomId = socket.data.roomId;
        if (!roomId)
            return;
        if (!isDrawerAuthorized(roomId, socket.id))
            return;
        roomDrawHistories.set(roomId, []);
        io.to(roomId).emit("draw:clear");
    });
    // 4. Undo last stroke
    socket.on("draw:undo", () => {
        const roomId = socket.data.roomId;
        if (!roomId)
            return;
        if (!isDrawerAuthorized(roomId, socket.id))
            return;
        const strokes = roomDrawHistories.get(roomId);
        if (strokes && strokes.length > 0) {
            strokes.pop();
            io.to(roomId).emit("draw:sync", { history: strokes });
        }
    });
    // 5. Request sync (on initial load / reconnect)
    socket.on("draw:request-sync", () => {
        const roomId = socket.data.roomId;
        if (!roomId)
            return;
        const history = roomDrawHistories.get(roomId) || [];
        socket.emit("draw:sync", { history });
    });
}
//# sourceMappingURL=drawHandlers.js.map