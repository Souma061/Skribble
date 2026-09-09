import { Eraser, Eye, Pencil, RotateCcw, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import type {
  NormalizedPoint,
  Stroke,
  StrokeChunkPayload,
  StrokeStartPayload,
} from "../types";
import {
  decodeBinaryChunk,
  encodeBinaryChunk,
  isBinaryPayload,
} from "../utils/binaryDrawing";

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
  const animFrameIdRef = useRef<number | null>(null);
  const strokeSeqRef = useRef<number>(0);

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
      const isEraserStroke = stroke.color.toLowerCase() === "#ffffff";
      ctx.globalCompositeOperation = isEraserStroke
        ? "destination-out"
        : "source-over";

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
        ctx.globalCompositeOperation = "source-over";
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
      ctx.globalCompositeOperation = "source-over";
    });
  }, []);

  // Coalesce high-frequency redraw requests to 60fps/120fps display refresh rate
  const requestRedraw = useCallback(() => {
    if (animFrameIdRef.current !== null) return;
    animFrameIdRef.current = requestAnimationFrame(() => {
      animFrameIdRef.current = null;
      redrawCanvas();
    });
  }, [redrawCanvas]);

  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
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

  // Batching interval: 60ms (~16 updates/sec, optimal for multiplayer canvas)
  const BATCH_INTERVAL_MS = 60;
  const MIN_POINT_DIST_SQ = 0.00001; // ~2-3px threshold to eliminate micro-jitter

  // Flush queued points over socket (throttled binary chunk)
  const flushBatch = useCallback(() => {
    if (
      !socket ||
      !currentStrokeRef.current ||
      batchBufferRef.current.length === 0
    )
      return;

    // Encode points into compact binary ArrayBuffer
    const binaryChunk = encodeBinaryChunk(
      strokeSeqRef.current,
      batchBufferRef.current,
    );
    socket.emit("draw:chunk", binaryChunk);

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
        requestRedraw();
      }
    };

    // 3. Remote Stroke Start
    const handleRemoteStart = (payload: StrokeStartPayload) => {
      const newStroke: Stroke = {
        id: payload.strokeId,
        seq: payload.seq,
        color: payload.color,
        size: payload.size,
        points: [payload.startPoint],
      };
      strokesRef.current.push(newStroke);
      requestRedraw();
    };

    // 4. Remote Stroke Chunk Stream (Binary & JSON compatible)
    const handleRemoteChunk = (payload: unknown) => {
      // A. Binary Protocol Path
      if (isBinaryPayload(payload)) {
        const { strokeSeq, points } = decodeBinaryChunk(payload);
        if (points.length === 0) return;

        const strokes = strokesRef.current;
        const lastStroke = strokes[strokes.length - 1];
        const stroke =
          lastStroke && lastStroke.seq === strokeSeq
            ? lastStroke
            : strokes.find((s) => s.seq === strokeSeq);

        if (stroke) {
          stroke.points.push(...points);
          requestRedraw();
        }
        return;
      }

      // B. JSON Fallback Path
      const jsonPayload = payload as StrokeChunkPayload;
      const strokes = strokesRef.current;
      const lastStroke = strokes[strokes.length - 1];
      const stroke =
        lastStroke && lastStroke.id === jsonPayload.strokeId
          ? lastStroke
          : strokes.find((s) => s.id === jsonPayload.strokeId);

      if (stroke) {
        stroke.points.push(...jsonPayload.points);
        requestRedraw();
      }
    };

    // 5. Remote Clear
    const handleRemoteClear = () => {
      strokesRef.current = [];
      requestRedraw();
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
  }, [socket, requestRedraw]);

  // Helper to get normalized 4-decimal precision point
  const getNormalizedPoint = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): NormalizedPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const rawX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const rawY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    return {
      x: Math.round(rawX * 10000) / 10000,
      y: Math.round(rawY * 10000) / 10000,
    };
  };

  // Pointer Down (Start Stroke)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || disabled) return;

    const normPoint = getNormalizedPoint(e);
    if (!normPoint) return;

    isDrawingRef.current = true;
    strokeSeqRef.current = (strokeSeqRef.current + 1) % 65535;
    const seq = strokeSeqRef.current;
    const strokeId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const currentColor = isEraser ? "#FFFFFF" : color;

    const newStroke: Stroke = {
      id: strokeId,
      seq,
      color: currentColor,
      size: brushSize,
      points: [normPoint],
    };

    currentStrokeRef.current = newStroke;
    strokesRef.current.push(newStroke);
    requestRedraw();

    // Emit start to room
    socket?.emit("draw:start", {
      strokeId,
      seq,
      color: currentColor,
      size: brushSize,
      startPoint: normPoint,
    });

    // Start 60ms batch timer (~16 updates/sec)
    if (batchTimerRef.current) clearInterval(batchTimerRef.current);
    batchTimerRef.current = setInterval(flushBatch, BATCH_INTERVAL_MS);
  };

  // Pointer Move (Draw & Accumulate Points with Distance Jitter Filter)
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      !isDrawer ||
      disabled ||
      !isDrawingRef.current ||
      !currentStrokeRef.current
    )
      return;

    const normPoint = getNormalizedPoint(e);
    if (!normPoint) return;

    // Jitter / distance filter: skip if movement is below threshold
    const pts = currentStrokeRef.current.points;
    if (pts.length > 0) {
      const lastPt = pts[pts.length - 1];
      const distSq =
        (normPoint.x - lastPt.x) ** 2 + (normPoint.y - lastPt.y) ** 2;
      if (distSq < MIN_POINT_DIST_SQ) return;
    }

    currentStrokeRef.current.points.push(normPoint);
    batchBufferRef.current.push(normPoint);

    // Smooth batched local redraw
    requestRedraw();
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
    requestRedraw();
    socket?.emit("draw:clear");
  };

  // Action: Undo
  const handleUndo = () => {
    if (!isDrawer || disabled || strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    requestRedraw();
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
          Room: {roomId}
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
          onPointerCancel={handlePointerUp}
          className={`w-full h-full block ${
            isDrawer && !disabled
              ? "cursor-crosshair"
              : "cursor-default pointer-events-none"
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
