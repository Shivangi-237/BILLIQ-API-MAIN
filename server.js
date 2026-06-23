
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import morgan from "morgan";

import { logger, stream } from "./logger.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { pool } from "./Database/db.js";
import vendorRoutes from "./routes/vendorRoutes.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("tiny", { stream }));

// timer logger
app.use((req, res, next) => {
  req._startTime = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - req._startTime;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${ms} ms`);
  });
  next();
});

// health
app.get("/health", (req, res) => res.json({ ok: true, service: "billiq-api", env: process.env.NODE_ENV || "dev" }));
app.get("/health/db", async (req, res, next) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: r.rows[0].now });
  } catch (e) { next(e); }
});

// mount APIs
app.use("/api/auth", authRoutes);
app.use("/api/invoices", invoiceRoutes);

// debug
app.get("/debug/test", (req, res) => res.json({ ok: true, msg: "debug route working ✅" }));
app.get("/debug/pool", (req, res) => {
  res.json({
    ok: true,
    pool: {
      totalCount: pool.totalCount ?? null,
      idleCount: pool.idleCount ?? null,
      waitingCount: pool.waitingCount ?? null
    }
  });
});

// error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err?.message || err}`);
  const payload = { ok: false, error: err.message || String(err) };
  if ((process.env.NODE_ENV || "dev") !== "production") payload.stack = err.stack;
  res.status(500).json(payload);
});

// multer file filter error handler
app.use((err, req, res, next) => {
  // Multer/fileFilter produced an Error with our message
  if (err && err.message && err.message.includes('Only PDF')) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  // pass on to existing error handler
  next(err);
});
app.use("/api/vendors", vendorRoutes);


process.on("unhandledRejection", (reason) => logger.error(`Unhandled Rejection: ${reason && reason.stack ? reason.stack : reason}`));
process.on("uncaughtException", (err) => logger.error(`Uncaught Exception: ${err.stack || err}`));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => logger.info(`🚀🔥 API on http://localhost:${PORT}`));
