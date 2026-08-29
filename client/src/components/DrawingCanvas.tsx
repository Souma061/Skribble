import React, { useEffect, useRef, useState, useCallback } from "react";
import { Socket } from "socket.io-client";
import {
  RotateCcw,
  Trash2,
  Eraser,
  Eye,
  Pencil,
} from "lucide-react";
import type { NormalizedPoint, Stroke, StrokeStartPayload, StrokeChunkPayload } from "../types";

interface DrawingCanvasProps {
  socket: Socket | null;
  roomId: string;
  isDrawer: boolean;
  drawerName?: string;
  disabled?: boolean;
}

const PASTEL_PALETTE = [
  "#2E1065", // Deep Charcoal Violet (Default)
  "#7C3AED", // Pastel Indigo
  "#EC4899", // Pastel Blush Pink
  "#EF4444", // Soft Coral Red
  "#F59E0B", // Buttercup Yellow
  "#10B981", // Soft Mint Green
  "#06B6D4", // Pastel Sky Cyan
  "#3B82F6", // Baby Blue
  "#8B5CF6", // Lavender
  "#9CA3AF", // Soft Slate Grey
];

const BRUSH_SIZES = [
  { label: "S", size: 3 },
  { label: "M", size: 7 },
  { label: "L", size: 14 },
  { label: "XL", size: 24 },
];

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  socket,
  roomId,
  isDrawer,
  drawerName = "Drawer",
  disabled = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Drawing Tools State
  const [color, setColor] = useState<string>(PASTEL_PALETTE[0]);
  const [brushSize, setBrushSize] = useState<number>(7);
  const [isEraser, setIsEraser] = useState<boolean>(false);

  // In-memory strokes
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef<boolean>(false);

  // Batching point buffer
  const batchBufferRef = useRef<NormalizedPoint[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redraw complete canvas with Bezier curve smoothing
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear whole canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokesRef.current.forEach((stroke) => {
      if (!stroke.points || stroke.points.length === 0) return;

      const pts = stroke.points;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const startX = pts[0].x * canvas.width;
      const startY = pts[0].y * canvas.height;

      if (pts.length === 1) {
        // Single dot
        ctx.arc(startX, startY, stroke.size / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
        return;
      }

      ctx.moveTo(startX, startY);

      for (let i = 1; i < pts.length; i++) {
        const p1x = pts[i - 1].x * canvas.width;
        const p1y = pts[i - 1].y * canvas.height;
        const p2x = pts[i].x * canvas.width;
        const p2y = pts[i].y * canvas.height;

        const midX = (p1x + p2x) / 2;
        const midY = (p1y + p2y) / 2;
        ctx.quadraticCurveTo(p1x, p1y, midX, midY);
      }

      ctx.stroke();
    });
  }, []);

  // Responsive Canvas Sizing (16:10 aspect ratio)
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      canvas.width = rect.width;
      canvas.height = rect.height;
      redrawCanvas();
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [redrawCanvas]);

  // Flush queued points over socket (throttled every 25ms)
  const flushBatch = useCallback(() => {
    if (!socket || !currentStrokeRef.current || batchBufferRef.current.length === 0) return;

    socket.emit("draw:chunk", {
      strokeId: currentStrokeRef.current.id,
      points: [...batchBufferRef.current],
    });

    batchBufferRef.current = [];
  }, [socket]);

  // Socket Event Listeners for Live Synchronization
  useEffect(() => {
    if (!socket) return;

    // 1. Request latest history
    socket.emit("draw:request-sync");

    // 2. Full history sync
    const handleSync = (payload: { history: Stroke[] }) => {
      if (Array.isArray(payload.history)) {
        strokesRef.current = payload.history;
        redrawCanvas();
      }
    };

    // 3. Remote Stroke Start
    const handleRemoteStart = (payload: StrokeStartPayload) => {
      const newStroke: Stroke = {
        id: payload.strokeId,
        color: payload.color,
        size: payload.size,
        points: [payload.startPoint],
      };
      strokesRef.current.push(newStroke);
      redrawCanvas();
    };

    // 4. Remote Stroke Chunk Stream
    const handleRemoteChunk = (payload: StrokeChunkPayload) => {
      const stroke = strokesRef.current.find((s) => s.id === payload.strokeId);
      if (stroke) {
        stroke.points.push(...payload.points);
        redrawCanvas();
      }
    };

    // 5. Remote Clear
    const handleRemoteClear = () => {
      strokesRef.current = [];
      redrawCanvas();
    };

    socket.on("draw:sync", handleSync);
    socket.on("draw:start", handleRemoteStart);
    socket.on("draw:chunk", handleRemoteChunk);
    socket.on("draw:clear", handleRemoteClear);

    return () => {
      socket.off("draw:sync", handleSync);
      socket.off("draw:start", handleRemoteStart);
      socket.off("draw:chunk", handleRemoteChunk);
      socket.off("draw:clear", handleRemoteClear);
    };
  }, [socket, redrawCanvas]);

  // Pointer Down (Start Stroke)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const normPoint: NormalizedPoint = {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };

    isDrawingRef.current = true;
    const strokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const currentColor = isEraser ? "#FFFFFF" : color;

    const newStroke: Stroke = {
      id: strokeId,
      color: currentColor,
      size: brushSize,
      points: [normPoint],
    };

    currentStrokeRef.current = newStroke;
    strokesRef.current.push(newStroke);
    redrawCanvas();

    // Emit start to room
    socket?.emit("draw:start", {
      strokeId,
      color: currentColor,
      size: brushSize,
      startPoint: normPoint,
    });

    // Start 25ms batch timer
    if (batchTimerRef.current) clearInterval(batchTimerRef.current);
    batchTimerRef.current = setInterval(flushBatch, 25);
  };

  // Pointer Move (Draw & Accumulate Points)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || disabled || !isDrawingRef.current || !currentStrokeRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const normPoint: NormalizedPoint = {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };

    currentStrokeRef.current.points.push(normPoint);
    batchBufferRef.current.push(normPoint);

    // Instant local redraw
    redrawCanvas();
  };

  // Pointer Up / Leave (Finalize Stroke)
  const handlePointerUp = () => {
    if (!isDrawer || disabled || !isDrawingRef.current) return;

    isDrawingRef.current = false;
    flushBatch();

    if (batchTimerRef.current) {
      clearInterval(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    currentStrokeRef.current = null;
  };

  // Action: Clear
  const handleClear = () => {
    if (!isDrawer || disabled) return;
    strokesRef.current = [];
    redrawCanvas();
    socket?.emit("draw:clear");
  };

  // Action: Undo
  const handleUndo = () => {
    if (!isDrawer || disabled || strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    redrawCanvas();
    socket?.emit("draw:undo");
  };

  return (
    <div className="w-full flex flex-col items-center gap-3">
      {/* Canvas Header Status Indicator */}
      <div className="w-full flex items-center justify-between px-2 text-xs font-bold text-[#6B7280]">
        <div className="flex items-center gap-2">
          {isDrawer ? (
            <span className="flex items-center gap-1.5 text-[#6D28D9] bg-[#EDE9FE] border border-[#DDD6FE] px-3.5 py-1 rounded-full shadow-xs animate-pulse">
              <Pencil className="w-3.5 h-3.5" />
              You are the Drawer &bull; Doodle away!
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[#4338CA] bg-[#E0E7FF] border border-[#C7D2FE] px-3.5 py-1 rounded-full shadow-xs">
              <Eye className="w-3.5 h-3.5" />
              Watching {drawerName} draw live...
            </span>
          )}
        </div>
        <span className="text-[11px] font-semibold text-[#9CA3AF]">
          Room: {roomId.slice(0, 8)}
        </span>
      </div>

      {/* Canvas Viewport */}
      <div
        ref={containerRef}
        className="w-full aspect-[16/10] bg-white rounded-3xl border-4 border-[#E9E4F7] pastel-card overflow-hidden relative touch-none select-none shadow-sm"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`w-full h-full block ${
            isDrawer && !disabled ? "cursor-crosshair" : "cursor-default pointer-events-none"
          }`}
        />
      </div>

      {/* Floating Pastel Drawing Toolbar (Active Drawer Only) */}
      {isDrawer && !disabled && (
        <div className="w-full bg-white rounded-3xl p-3 border border-[#E9E4F7] pastel-card flex flex-wrap items-center justify-between gap-3 animate-fade-in">
          {/* 10 Pastel Color Swatches */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            {PASTEL_PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => {
                  setColor(swatch);
                  setIsEraser(false);
                }}
                style={{ backgroundColor: swatch }}
                className={`w-7 h-7 rounded-full transition-transform cursor-pointer shadow-xs ${
                  color === swatch && !isEraser
                    ? "ring-3 ring-offset-2 ring-[#7C3AED] scale-110"
                    : "hover:scale-105 opacity-90 hover:opacity-100"
                }`}
                title={`Color: ${swatch}`}
              />
            ))}
          </div>

          {/* Brush Thickness Sizes */}
          <div className="flex items-center gap-1 bg-[#F3F4F6] p-1 rounded-2xl">
            {BRUSH_SIZES.map((b) => (
              <button
                key={b.size}
                type="button"
                onClick={() => setBrushSize(b.size)}
                className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  brushSize === b.size
                    ? "bg-white text-[#7C3AED] shadow-xs"
                    : "text-[#6B7280] hover:text-[#1F2937]"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Tool Actions: Eraser, Undo, Clear */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsEraser(!isEraser)}
              className={`p-2 rounded-2xl border text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                isEraser
                  ? "bg-[#EDE9FE] border-[#C4B5FD] text-[#6D28D9]"
                  : "bg-white border-[#E5E7EB] text-[#4B5563] hover:bg-[#F9FAFB]"
              }`}
              title="Toggle Eraser"
            >
              <Eraser className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleUndo}
              className="p-2 rounded-2xl bg-white border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[#4B5563] text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
              title="Undo last stroke"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleClear}
              className="px-3 py-2 rounded-2xl bg-[#FEE2E2] hover:bg-[#FECACA] text-[#991B1B] text-xs font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
              title="Clear entire canvas"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
