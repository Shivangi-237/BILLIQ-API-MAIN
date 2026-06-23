import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import sharp from "sharp";

import { dbQuery } from "../Database/db.js";
import { logger } from "../logger.js";
import { saveFileAndGetMetadata } from "./fileUploadHandler.js";
import { parseAmount } from "./helpers.js";

export async function uploadInvoice(req, res, next) {
  try {
    logger.info(
      `UPLOAD-REQ body keys: ${Object.keys(req.body || {}).join(", ")}`
    );
    logger.info(`UPLOAD-REQ raw amount: ${JSON.stringify(req.body?.amount)}`);
    logger.info(
      `UPLOAD-REQ file: name=${req.file?.originalname} mime=${req.file?.mimetype} size=${req.file?.size}`
    );

    if (!req.file)
      return res.status(400).json({ ok: false, error: "No file provided" });

    const original = String(req.file.originalname || "upload").trim();
    const invoice_no = (
      req.body.invoice_no || `INV-${Date.now().toString().slice(-6)}`
    ).toString();
    const vendor_name = String(
      req.body.vendor || original.split(".")[0] || "Unknown"
    )
      .slice(0, 255)
      .trim();

    let amount = null;
    if (
      req.body.amount !== undefined &&
      req.body.amount !== null &&
      req.body.amount !== ""
    ) {
      amount = parseAmount(req.body.amount);
      if (amount === null || amount <= 0)
        return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const invoice_date =
      req.body.invoice_date || new Date().toISOString().slice(0, 10);
    const gst_no =
      req.body.gst_no ?? (Math.random() > 0.2 ? "22AAAAA0000A1Z5" : null);
    const status = (req.body.status || "PENDING").toUpperCase();

    if (!vendor_name || vendor_name.length < 2)
      return res.status(400).json({ ok: false, error: "Vendor name required" });

    const dup = await dbQuery(
      "SELECT id FROM invoices WHERE invoice_no = $1 LIMIT 1",
      [invoice_no]
    );
    if (dup.rows.length)
      return res.status(400).json({ ok: false, error: "Duplicate invoice_no" });

    const fileMeta = await saveFileAndGetMetadata(req.file);

    logger.info(
      `DBG BEFORE INSERT -> invoice_no=${invoice_no}, vendor=${vendor_name}, amount=${amount}, file_path=${fileMeta.file_path}`
    );
    logger.info(
      `DBG VALUES ARRAY -> ${JSON.stringify([
        invoice_no,
        vendor_name,
        amount,
        invoice_date,
        gst_no,
        status,
        fileMeta.file_name,
        fileMeta.file_type,
        fileMeta.file_size,
        fileMeta.file_path,
        fileMeta.uploaded_at,
      ])}`
    );

    const insertSQL = `
      INSERT INTO invoices
        (invoice_no, vendor_name, amount, invoice_date, gst_no, status,
         file_name, file_type, file_size, file_path, uploaded_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *;
    `;

    const values = [
      invoice_no,
      vendor_name,
      amount,
      invoice_date,
      gst_no,
      status,
      fileMeta.file_name,
      fileMeta.file_type,
      fileMeta.file_size,
      fileMeta.file_path,
      fileMeta.uploaded_at,
    ];

    const r = await dbQuery(insertSQL, values);
    const inserted = r.rows[0];

    logger.info(
      `Inserted invoice id=${inserted.id} file=${fileMeta.file_name} size=${fileMeta.file_size} path=${fileMeta.file_path}`
    );

    return res.json({
      ok: true,
      message: "Invoice inserted with file metadata",
      file: fileMeta,
      inserted,
    });
  } catch (e) {
    next(e);
  }
}

export async function getInvoices(req, res, next) {
  try {
    const {
      vendor,
      status,
      from,
      to,
      page = 1,
      limit = 20,
      sort = "uploaded_at",
      order = "desc",
    } = req.query;

    const offset = (Math.max(Number(page), 1) - 1) * Number(limit);
    const params = [];
    const whereClauses = [];

    if (vendor) {
      params.push(`%${vendor}%`);
      whereClauses.push(`vendor_name ILIKE $${params.length}`);
    }
    if (status) {
      params.push(status);
      whereClauses.push(`status = $${params.length}`);
    }
    if (from) {
      params.push(from);
      whereClauses.push(`invoice_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      whereClauses.push(`invoice_date <= $${params.length}`);
    }

    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";
    const countSQL = `SELECT COUNT(*) AS total FROM invoices ${whereSQL}`;
    const countRes = await dbQuery(countSQL, params);
    const total = Number(countRes.rows[0].total);

    const allowedSort = ["uploaded_at", "created_at", "amount", "invoice_date"];
    const sortField = allowedSort.includes(sort) ? sort : "uploaded_at";
    const orderDir = order.toLowerCase() === "asc" ? "ASC" : "DESC";

    const dataSQL = `
      SELECT id, invoice_no, vendor_name, amount, invoice_date, gst_no, status, file_name, file_type, file_size, uploaded_at, created_at
      FROM invoices
      ${whereSQL}
      ORDER BY ${sortField} ${orderDir} NULLS LAST
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(Number(limit));
    params.push(Number(offset));

    const dataRes = await dbQuery(dataSQL, params);
    res.json({
      ok: true,
      meta: { total, page: Number(page), limit: Number(limit) },
      rows: dataRes.rows,
    });
  } catch (e) {
    next(e);
  }
}

export async function getInvoiceById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id)
      return res.status(400).json({ ok: false, error: "Invalid invoice id" });

    const r = await dbQuery(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [
      id,
    ]);
    if (!r.rows.length)
      return res.status(404).json({ ok: false, error: "Invoice not found" });

    return res.json({ ok: true, invoice: r.rows[0] });
  } catch (e) {
    next(e);
  }
}

export async function updateInvoiceStatus(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id)
      return res.status(400).json({ ok: false, error: "Invalid invoice id" });

    const { status } = req.body;
    if (!status || typeof status !== "string")
      return res.status(400).json({ ok: false, error: "status is required" });

    const allowed = ["PENDING", "LEGIT", "SUSPICIOUS", "REVIEW", "DUPLICATE"];
    const up = status.toUpperCase();
    if (!allowed.includes(up))
      return res.status(400).json({
        ok: false,
        error: `invalid status; allowed: ${allowed.join(", ")}`,
      });

    const r = await dbQuery(
      `UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *`,
      [up, id]
    );
    if (!r.rows.length)
      return res.status(404).json({ ok: false, error: "Invoice not found" });

    logger.info(`STATUS-UPDATE id=${id} status=${up} by=api`);
    return res.json({ ok: true, updated: r.rows[0] });
  } catch (e) {
    next(e);
  }
}

export async function recentInvoices(req, res, next) {
  try {
    const limit = Math.min(100, Number(req.query.limit || 5));
    const r = await dbQuery(
      `SELECT id, invoice_no, vendor_name, amount, invoice_date, uploaded_at, status, file_name, file_type, file_size, review
       FROM invoices
       ORDER BY uploaded_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(
      r.rows.map((row) => ({
        ...row,
        amount: row.amount === null ? null : Number(row.amount),
      }))
    );
  } catch (e) {
    next(e);
  }
}

export async function updateInvoiceReview(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id)
      return res.status(400).json({ ok: false, error: "Invalid invoice id" });

    const { review } = req.body;
    if (typeof review !== "string")
      return res
        .status(400)
        .json({ ok: false, error: "review must be string" });

    const r = await dbQuery(
      `UPDATE invoices SET review = $1 WHERE id = $2 RETURNING *`,
      [review, id]
    );
    if (!r.rows.length)
      return res.status(404).json({ ok: false, error: "Invoice not found" });
    res.json({ ok: true, updated: r.rows[0] });
  } catch (e) {
    next(e);
  }
}

export async function deleteInvoice(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id)
      return res.status(400).json({ ok: false, error: "Invalid invoice id" });

    const r = await dbQuery(`SELECT file_path FROM invoices WHERE id = $1`, [
      id,
    ]);
    if (!r.rows.length)
      return res.status(404).json({ ok: false, error: "Invoice not found" });

    const filePath = r.rows[0].file_path;

    await dbQuery(`DELETE FROM invoices WHERE id = $1`, [id]);

    // resolve filePath before deleting to avoid wrong relative deletion
    if (filePath) {
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        fs.unlinkSync(resolved);
      } else {
        // also try uploads fallback
        const alt = path.resolve(process.cwd(), "uploads", path.basename(filePath));
        if (fs.existsSync(alt) && fs.statSync(alt).isFile()) fs.unlinkSync(alt);
      }
    }

    logger.info(`INVOICE-DELETE id=${id}`);

    res.json({
      ok: true,
      deleted_id: id,
      message: "Invoice deleted successfully",
    });
  } catch (e) {
    next(e);
  }
}

// previewInvoice streams inline (existing behavior)
export async function previewInvoice(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id)
      return res.status(400).json({ ok: false, error: "Invalid invoice id" });

    const r = await dbQuery(
      "SELECT file_name, file_type, file_path, file_data FROM invoices WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!r.rows.length)
      return res.status(404).json({ ok: false, error: "Invoice not found" });

    const { file_name, file_type, file_path, file_data } = r.rows[0];

    const cwd = process.cwd();
    const candidates = [];

    if (file_path) {
      const normalized = path.normalize(String(file_path));
      candidates.push(normalized);
      if (!path.isAbsolute(normalized))
        candidates.push(path.resolve(cwd, normalized));
      candidates.push(path.resolve(cwd, "uploads", file_name || ""));
    } else {
      candidates.push(path.resolve(cwd, "uploads", file_name || ""));
    }

    for (const p of candidates) {
      if (!p) continue;
      try {
        const st = fs.existsSync(p) ? fs.statSync(p) : null;
        if (st && st.isFile()) {
          logger.info(`PREVIEW: streaming id=${id} path=${p}`);
          res.setHeader("Content-Type", file_type || "application/octet-stream");
          res.setHeader(
            "Content-Disposition",
            `inline; filename="${file_name || "invoice"}"`
          );
          return fs.createReadStream(p).pipe(res);
        } else if (st && st.isDirectory()) {
          logger.warn(
            `PREVIEW: candidate is directory (skipping) id=${id} path=${p}`
          );
        }
      } catch (err) {
        logger.warn(`PREVIEW: fs error for ${p} -> ${err.message}`);
      }
    }

    if (file_data) {
      logger.info(`PREVIEW: streaming DB file_data id=${id}`);
      res.setHeader("Content-Type", file_type || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${file_name || "invoice"}"`
      );
      if (Buffer.isBuffer(file_data)) return res.send(file_data);
      try {
        return res.send(Buffer.from(String(file_data), "base64"));
      } catch {
        return res.send(String(file_data));
      }
    }

    logger.info(
      `PREVIEW: no file found for id=${id} candidates=${JSON.stringify(
        candidates
      )}`
    );
    return res.status(404).json({
      ok: false,
      error: "No file stored (no usable file found)",
      debug: { id, file_name, file_path, candidates },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * downloadInvoice
 * - GET /api/invoices/:id/download
 * - Query param: asPdf=true  -> convert image to PDF on-the-fly and send PDF
 * - otherwise returns raw file bytes with Content-Disposition: attachment
 */
export async function downloadInvoice(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid invoice id" });

    const r = await dbQuery(
      "SELECT file_name, file_type, file_path, file_data FROM invoices WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: "Invoice not found" });

    const { file_name, file_type, file_path, file_data } = r.rows[0];

    // Build candidates similar to preview
    const cwd = process.cwd();
    const candidates = [];
    if (file_path) {
      const normalized = path.normalize(String(file_path));
      candidates.push(normalized);
      if (!path.isAbsolute(normalized)) candidates.push(path.resolve(cwd, normalized));
    }
    if (file_name) candidates.push(path.resolve(cwd, "uploads", file_name));

    // helper to read disk buffer
    const readIfFile = async (p) => {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return { path: p, buf: await fs.promises.readFile(p), size: fs.statSync(p).size };
        }
      } catch (err) {
        logger.warn(`DOWNLOAD: fs error for ${p} -> ${err.message}`);
      }
      return null;
    };

    let diskResult = null;
    for (const p of candidates) {
      if (!p) continue;
      diskResult = await readIfFile(p);
      if (diskResult) break;
    }

    // get buffer either from disk or DB
    let buffer = diskResult ? diskResult.buf : null;
    let diskSize = diskResult ? diskResult.size : null;

    if (!buffer && file_data) {
      if (Buffer.isBuffer(file_data)) buffer = file_data;
      else {
        try {
          buffer = Buffer.from(String(file_data), "base64");
        } catch {
          buffer = Buffer.from(String(file_data), "binary");
        }
      }
    }

    if (!buffer) {
      return res.status(404).json({ ok: false, error: "No file available for download", debug: { id, file_name, file_path, candidates } });
    }

    const asPdf = String(req.query.asPdf || "").toLowerCase() === "true";

    // Convert image -> pdf when requested (asPdf=true)
    if (asPdf || (file_type && String(file_type).startsWith("image/") && String(req.query.forceImagePdf || "").toLowerCase() === "true")) {
      // stream generated PDF
      res.setHeader("Content-Type", "application/pdf");
      const outName = (file_name ? file_name.replace(/\.[^.]+$/, "") : `invoice-${id}`) + ".pdf";
      res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);

      const doc = new PDFDocument({ autoFirstPage: false });
      doc.pipe(res);

      try {
        const img = sharp(buffer);
        const meta = await img.metadata();
        // Use sensible defaults if metadata missing
        const widthPx = meta.width || 800;
        const heightPx = meta.height || 1000;

        // convert to PNG (pdfkit will accept PNG/JPEG)
        const processed = await img.ensureAlpha().png().toBuffer();

        // Add page sized to image (in PDF points ~ pixels at 72 DPI). This is simple and effective.
        doc.addPage({ size: [widthPx, heightPx] });
        doc.image(processed, 0, 0, { width: widthPx, height: heightPx });
      } catch (err) {
        logger.warn(`DOWNLOAD: image->pdf conversion failed id=${id} -> ${err.message}`);
        // fallback: try to add raw buffer to pdf (pdfkit may accept)
        doc.addPage();
        try {
          doc.image(buffer, { fit: [500, 700], align: "center", valign: "center" });
        } catch (err2) {
          doc.text("Unable to embed image for PDF conversion", { align: "center" });
        }
      }

      doc.end();
      return;
    }

    // else send raw bytes with correct headers
    const outName = file_name || `invoice-${id}`;
    res.setHeader("Content-Type", file_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    if (diskSize) res.setHeader("Content-Length", diskSize);
    return res.send(buffer);
  } catch (e) {
    next(e);
  }
}
