import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  metricsHandler,
  metricsMiddleware,
  requireMetricsAuth,
  setupSocketMetrics,
} from "./metrics.js";
import { registerSocketHandlers } from "./roomHandlers.js";

dotenv.config();

if (!process.env.METRICS_TOKEN) {
  console.warn("[WARN] METRICS_TOKEN is not set — the /metrics endpoint will return 503");
}

const app = express();
const httpServer = createServer(app);

// Restrict CORS to the deployed client origin (set CLIENT_URL in your .env)
const CLIENT_ORIGIN = process.env.CLIENT_URL || "https://skribble-eight.vercel.app";

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());
app.use(metricsMiddleware);

const port = Number(process.env.PORT) || 9000;

app.get("/health", (_req, res) => {
  res.send("OK");
});

app.get("/metrics", requireMetricsAuth, metricsHandler);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
  },
});

setupSocketMetrics(io);
registerSocketHandlers(io);

httpServer.listen(port, () => {
  console.log(`HTTP + Socket.IO running on port ${port}`);
});
