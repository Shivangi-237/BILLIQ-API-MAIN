// routes/vendorRoutes.js
import express from "express";
import authMiddleware from "../Middleware/authMiddleware.js";
import { dbQuery } from "../Database/db.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

/**
 * GET /api/vendors/search?q=...
 * Return up to 20 distinct vendor names matching query (ILIKE)
 */
router.get("/search", authMiddleware, async (req, res, next) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json([]);
    const r = await dbQuery(
      `SELECT DISTINCT vendor_name FROM invoices
       WHERE vendor_name ILIKE $1
       ORDER BY vendor_name
       LIMIT 20`,
      [`%${q}%`]
    );
    res.json(r.rows.map(x => x.vendor_name));
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/vendors/cleanup?before=YYYY-MM-DD
 * Admin-only: delete invoices with invoice_date < before
 */
router.delete("/cleanup", authMiddleware, async (req, res, next) => {
  try {
    // admin check - assumes authMiddleware sets req.user.email
    const adminEmail = (process.env.ADMIN_EMAIL || "admin@billiq.com").toLowerCase();
    const userEmail = (req.user && req.user.email) ? String(req.user.email).toLowerCase() : null;
    if (!userEmail || userEmail !== adminEmail) {
      return res.status(403).json({ ok: false, error: "forbidden: admin only" });
    }

    const before = req.query.before;
    if (!before) return res.status(400).json({ ok: false, error: "Missing ?before=YYYY-MM-DD" });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      return res.status(400).json({ ok: false, error: "Invalid date format. Use YYYY-MM-DD" });
    }

    const r = await dbQuery("DELETE FROM invoices WHERE invoice_date < $1", [before]);

    // optional logging if req.logger exists
    try {
      req.logger?.info?.(`CLEANUP performed by=${userEmail} before=${before} deleted=${r.rowCount}`);
    } catch (_) { /* ignore logging errors */ }

    return res.json({ ok: true, deleted: r.rowCount });
  } catch (e) {
    next(e);
  }
});

export default router;
