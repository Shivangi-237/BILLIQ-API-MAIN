// routes/authRoutes.js
import express from "express";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: "Email and password are required" });

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@billiq.com";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
    const STATIC_TOKEN = process.env.API_STATIC_TOKEN || "supersecrettoken123";

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      return res.json({ ok: true, token: STATIC_TOKEN });
    } else {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
