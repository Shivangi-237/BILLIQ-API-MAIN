// routes/invoiceRoutes.js
import express from "express";
import multer from "multer";
import authMiddleware from "../Middleware/authMiddleware.js";
import { dbQuery } from "../Database/db.js";
import fs from "fs";
import path from "path";

import {
  uploadInvoice,
  getInvoices,
  analyticsSummary,
  getInvoiceById,
  updateInvoiceStatus,
  analyticsTrend,
  recentInvoices,
  updateInvoiceReview,
  deleteInvoice,
  previewInvoice,
  downloadInvoice, // <- ensure this is exported from controller
} from "../controllers/invoiceController.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only PDF, JPG and PNG files are allowed"));
    }
    cb(null, true);
  },
});

// analytics
router.get("/analytics/trend", authMiddleware, analyticsTrend);
router.get("/analytics/summary", authMiddleware, analyticsSummary);

// recent & list
router.get("/recent", authMiddleware, recentInvoices);
router.get("/", authMiddleware, getInvoices);

// upload
router.post("/upload", authMiddleware, upload.single("file"), uploadInvoice);

// lookup by invoice_no (query param)
router.get("/file", authMiddleware, async (req, res, next) => {
  try {
    const invoice_no = (req.query.invoice_no || "").trim();
    if (!invoice_no) return res.status(400).json({ ok: false, error: "Provide ?invoice_no" });

    const r = await dbQuery(
      "SELECT file_name, file_type, file_path, file_data FROM invoices WHERE invoice_no = $1 LIMIT 1",
      [invoice_no]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: "Invoice not found" });

    const { file_name, file_type, file_path, file_data } = r.rows[0];

    // try disk path first (absolute or relative)
    const candidates = [];
    if (file_path) {
      const normalized = path.normalize(String(file_path));
      candidates.push(normalized);
      if (!path.isAbsolute(normalized)) candidates.push(path.resolve(process.cwd(), normalized));
    }
    if (file_name) candidates.push(path.resolve(process.cwd(), "uploads", file_name));

    for (const p of candidates) {
      if (!p) continue;
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          res.setHeader("Content-Disposition", `attachment; filename="${file_name || 'invoice'}"`);
          res.setHeader("Content-Type", file_type || "application/octet-stream");
          return fs.createReadStream(p).pipe(res);
        }
      } catch (err) {
        return next(err);
      }
    }

    // fallback to DB bytes
    if (file_data) {
      res.setHeader("Content-Disposition", `attachment; filename="${file_name || 'invoice'}"`);
      res.setHeader("Content-Type", file_type || "application/octet-stream");
      if (Buffer.isBuffer(file_data)) return res.send(file_data);
      try {
        return res.send(Buffer.from(String(file_data), "base64"));
      } catch {
        return res.send(String(file_data));
      }
    }

    return res.status(404).json({ ok: false, error: "No file stored" });
  } catch (e) {
    next(e);
  }
});

// stream file by id (prefers disk then DB)
router.get("/:id/file", authMiddleware, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid invoice id" });

    const r = await dbQuery("SELECT file_name, file_type, file_path, file_data FROM invoices WHERE id = $1 LIMIT 1", [id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: "Invoice not found" });

    const { file_name, file_type, file_path, file_data } = r.rows[0];

    const candidates = [];
    if (file_path) {
      const normalized = path.normalize(String(file_path));
      candidates.push(normalized);
      if (!path.isAbsolute(normalized)) candidates.push(path.resolve(process.cwd(), normalized));
    }
    if (file_name) candidates.push(path.resolve(process.cwd(), "uploads", file_name));

    for (const p of candidates) {
      if (!p) continue;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        res.setHeader("Content-Disposition", `attachment; filename="${file_name || 'invoice'}"`);
        res.setHeader("Content-Type", file_type || "application/octet-stream");
        return fs.createReadStream(p).pipe(res);
      }
    }

    if (file_data) {
      res.setHeader("Content-Disposition", `attachment; filename="${file_name || 'invoice'}"`);
      res.setHeader("Content-Type", file_type || "application/octet-stream");
      if (Buffer.isBuffer(file_data)) return res.send(file_data);
      try {
        return res.send(Buffer.from(String(file_data), "base64"));
      } catch {
        return res.send(String(file_data));
      }
    }

    return res.status(404).json({ ok: false, error: "No file stored" });
  } catch (e) {
    next(e);
  }
});

// download endpoint (forces attachment, supports ?asPdf=true handled by controller)
router.get("/:id/download", authMiddleware, downloadInvoice);

// preview (inline)
router.get("/:id/preview", authMiddleware, previewInvoice);

// invoice CRUD
router.get("/:id", authMiddleware, getInvoiceById);
router.patch("/:id/status", authMiddleware, express.json(), updateInvoiceStatus);
router.patch("/:id/review", authMiddleware, express.json(), updateInvoiceReview);
router.delete("/:id", authMiddleware, deleteInvoice);

export default router;
