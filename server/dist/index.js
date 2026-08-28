import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./roomHandlers.js";
dotenv.config();
const app = express();
const httpServer = createServer(app);
app.use(cors());
app.use(express.json());
const port = Number(process.env.PORT) || 9000;
app.get("/health", (_req, res) => {
    res.send("OK");
});
const io = new Server(httpServer, {
    cors: {
        origin: "*",
    },
});
registerSocketHandlers(io);
httpServer.listen(port, () => {
    console.log(`HTTP + Socket.IO running on port ${port}`);
});
//# sourceMappingURL=index.js.map