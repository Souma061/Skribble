import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import client from "prom-client";
import type { Server as SocketIOServer } from "socket.io";
import { getTotalCachedStrokesCount } from "./drawHandlers.js";
import { getRoomCount, getTotalPlayerCount } from "./rooms.js";

// Initialize the default Prometheus registry
const register = new client.Registry();

// Add default recommended metrics (CPU, Memory, Event Loop Lag, GC, Active Handles)
client.collectDefaultMetrics({
  register,
  prefix: "skribble_",
});

// Custom Gauges
export const activeSocketConnectionsGauge = new client.Gauge({
  name: "skribble_active_socket_connections",
  help: "Current number of active Socket.IO connections",
  registers: [register],
  collect() {
    if (attachedIO) {
      this.set(attachedIO.engine.clientsCount);
    }
  },
});

export const activeRoomsGauge = new client.Gauge({
  name: "skribble_active_rooms",
  help: "Current number of active in-memory game rooms",
  registers: [register],
  collect() {
    this.set(getRoomCount());
  },
});

export const activePlayersGauge = new client.Gauge({
  name: "skribble_active_players",
  help: "Current number of active players across all rooms",
  registers: [register],
  collect() {
    this.set(getTotalPlayerCount());
  },
});

export const cachedDrawingStrokesGauge = new client.Gauge({
  name: "skribble_drawing_cached_strokes",
  help: "Current number of drawing strokes cached in memory across all rooms",
  registers: [register],
  collect() {
    this.set(getTotalCachedStrokesCount());
  },
});

// Custom Counters
export const drawingStrokesCounter = new client.Counter({
  name: "skribble_drawing_strokes_total",
  help: "Total count of drawing stroke lifecycle actions",
  labelNames: ["action"] as const, // start, end, clear, undo
  registers: [register],
});

export const drawingChunksCounter = new client.Counter({
  name: "skribble_drawing_chunks_total",
  help: "Total count of drawing chunks streamed",
  labelNames: ["format"] as const, // binary, json
  registers: [register],
});

export const drawingPointsCounter = new client.Counter({
  name: "skribble_drawing_points_total",
  help: "Total count of coordinate points processed for drawing",
  labelNames: ["format"] as const, // binary, json
  registers: [register],
});

export const drawingBytesCounter = new client.Counter({
  name: "skribble_drawing_bytes_total",
  help: "Total bytes received for drawing stroke data",
  labelNames: ["format"] as const, // binary, json
  registers: [register],
});

export const socketEventsCounter = new client.Counter({
  name: "skribble_socket_events_total",
  help: "Total count of Socket.IO events processed",
  labelNames: ["event", "direction"] as const,
  registers: [register],
});

export const httpRequestsCounter = new client.Counter({
  name: "skribble_http_requests_total",
  help: "Total count of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [register],
});

// Custom Histograms
export const httpRequestDurationHistogram = new client.Histogram({
  name: "skribble_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const TRACKED_SOCKET_EVENTS = new Set([
  "room:create",
  "room:join",
  "room:leave",
  "room:delete",
  "game:start",
  "round:set-word",
  "chat:send",
  "draw:start",
  "draw:chunk",
  "draw:clear",
  "draw:undo",
  "draw:request-sync",
]);

const TRACKED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

export function getSocketEventLabel(eventName: string): string {
  return TRACKED_SOCKET_EVENTS.has(eventName) ? eventName : "other";
}

export function getHttpMethodLabel(method: string): string {
  const normalizedMethod = method.toUpperCase();
  return TRACKED_HTTP_METHODS.has(normalizedMethod) ? normalizedMethod : "OTHER";
}

export function getHttpRouteLabel(routePath: unknown): string {
  return typeof routePath === "string" ? routePath : "unknown";
}

let attachedIO: SocketIOServer | null = null;

/**
 * Attaches the Socket.IO server to the metrics system to track connection counts and event streams.
 */
export function setupSocketMetrics(io: SocketIOServer) {
  attachedIO = io;

  io.on("connection", (socket) => {
    activeSocketConnectionsGauge.set(io.engine.clientsCount);
    socketEventsCounter.inc({ event: "connection", direction: "inbound" });

    // Keep label cardinality bounded even when clients emit arbitrary event names.
    socket.onAny((eventName) => {
      socketEventsCounter.inc({ event: getSocketEventLabel(eventName), direction: "inbound" });
    });

    socket.on("disconnect", () => {
      activeSocketConnectionsGauge.set(io.engine.clientsCount);
      socketEventsCounter.inc({ event: "disconnect", direction: "inbound" });
    });
  });
}

/**
 * Express middleware to track HTTP request rates and latencies.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/metrics") {
    return next();
  }

  const start = process.hrtime();

  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const route = getHttpRouteLabel(req.route?.path);
    const method = getHttpMethodLabel(req.method);
    const statusCode = res.statusCode.toString();

    httpRequestsCounter.inc({
      method,
      route,
      status_code: statusCode,
    });

    httpRequestDurationHistogram.observe(
      {
        method,
        route,
        status_code: statusCode,
      },
      durationInSeconds,
    );
  });

  next();
}

function tokensMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function requireMetricsAuth(req: Request, res: Response, next: NextFunction) {
  const expectedToken = process.env.METRICS_TOKEN?.trim();
  if (!expectedToken) {
    res.status(503).end("Metrics endpoint is not configured");
    return;
  }

  const authorization = req.get("authorization") ?? "";
  const providedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!providedToken || !tokensMatch(providedToken, expectedToken)) {
    res.set("WWW-Authenticate", "Bearer");
    res.status(401).end("Unauthorized");
    return;
  }

  next();
}

/**
 * Express route handler for /metrics endpoint
 */
export async function metricsHandler(_req: Request, res: Response) {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end((err as Error).message);
  }
}
