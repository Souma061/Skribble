import { Server, Socket } from "socket.io";
export interface NormalizedPoint {
    x: number;
    y: number;
}
export interface Stroke {
    id: string;
    seq?: number | undefined;
    color: string;
    size: number;
    points: NormalizedPoint[];
}
export declare function getRoomStrokes(roomId: string): Stroke[];
export declare function getTotalCachedStrokesCount(): number;
export declare function clearRoomStrokes(roomId: string): void;
export declare function registerDrawHandlers(io: Server, socket: Socket): void;
//# sourceMappingURL=drawHandlers.d.ts.map