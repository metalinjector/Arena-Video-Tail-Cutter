import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve the built frontend (single-container / standalone deployment).
// Enabled when PUBLIC_DIR points at the Vite build output. In Replit dev the
// frontend is served by its own Vite dev server, so PUBLIC_DIR is left unset
// and this block is skipped.
const publicDir = process.env.PUBLIC_DIR;
if (publicDir && fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback: serve index.html for any non-API GET request.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });
  logger.info({ publicDir }, "Serving static frontend");
}

export default app;
