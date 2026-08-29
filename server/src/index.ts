import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./roomHandlers.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Restrict CORS to the deployed client origin (set CLIENT_URL in your .env)
const CLIENT_ORIGIN = process.env.CLIENT_URL || "https://skribble-eight.vercel.app";

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const port = Number(process.env.PORT) || 9000;

app.get("/health", (_req, res) => {
  res.send("OK");
});

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
  },
});

registerSocketHandlers(io);

httpServer.listen(port, () => {
  console.log(`HTTP + Socket.IO running on port ${port}`);
});
