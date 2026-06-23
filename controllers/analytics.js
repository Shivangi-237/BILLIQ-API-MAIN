import { dbQuery } from "../Database/db.js";

export async function analyticsSummary(req, res, next) {
  try {
    const threshold = Number(req.query.threshold ?? 100000);

    // total invoices
    const totalQ = await dbQuery("SELECT COUNT(*) AS total FROM invoices");
    const total = Number(totalQ.rows[0].total);

    // average amount
    const avgQ = await dbQuery("SELECT AVG(amount) AS avg_amount FROM invoices WHERE amount IS NOT NULL");
    const avg_amount = avgQ.rows[0].avg_amount === null ? 0 : Number(Number(avgQ.rows[0].avg_amount).toFixed(2));

    // duplicate groups (invoice_no + vendor_name)
    const dupQ = await dbQuery(`
      SELECT COUNT(*) AS duplicate_groups
      FROM (
        SELECT invoice_no, vendor_name
        FROM invoices
        WHERE invoice_no IS NOT NULL
        GROUP BY invoice_no, vendor_name
        HAVING COUNT(*) > 1
      ) t
    `);
    const duplicate_groups = Number(dupQ.rows[0].duplicate_groups);

    // suspicious (amount > threshold OR missing gst OR invoice_date in future)
    const suspiciousQ = await dbQuery(
      `SELECT COUNT(*) AS suspicious FROM invoices
       WHERE (amount > $1) OR (gst_no IS NULL) OR (invoice_date > NOW()::date)`,
      [threshold]
    );
    const suspicious = Number(suspiciousQ.rows[0].suspicious);

    // counts per status (including NULL -> UNKNOWN)
    const statusQ = await dbQuery(`
      SELECT COALESCE(status,'UNKNOWN') AS status, COUNT(*) AS cnt
      FROM invoices
      GROUP BY COALESCE(status,'UNKNOWN')
    `);
    const status_counts = {};
    for (const row of statusQ.rows) status_counts[row.status] = Number(row.cnt);

    // top vendors
    const topVendorsQ = await dbQuery(`
      SELECT vendor_name, COUNT(*) AS cnt
      FROM invoices
      GROUP BY vendor_name
      ORDER BY cnt DESC
      LIMIT 5
    `);

    res.json({
      ok: true,
      summary: {
        total,
        avg_amount,
        duplicate_groups,
        suspicious,
        threshold,
        status_counts,                  // e.g. { PENDING: 10, LEGIT: 50, SUSPICIOUS: 2 }
        legit_count: status_counts.LEGIT || 0,
        top_vendors: topVendorsQ.rows
      }
    });
  } catch (e) {
    next(e);
  }
}



// analytics trend: group by day/week/month
export async function analyticsTrend(req, res, next) {
  try {
    const period = (req.query.period || "day").toLowerCase(); // day|week|month
    const status = req.query.status; // optional

    // map period to sql date_trunc format and output date format
    const trunc = period === "month" ? "month" : period === "week" ? "week" : "day";

    const params = [];
    let where = "";
    if (status) { params.push(status); where = `WHERE status = $${params.length}`; }

    const sql = `
      SELECT
        to_char(date_trunc('${trunc}', uploaded_at)::date, 'YYYY-MM-DD') AS date,
        COUNT(*)::int AS count,
        COALESCE(SUM(CASE WHEN amount IS NOT NULL THEN amount ELSE 0 END),0)::numeric(18,2) AS total_amount
      FROM invoices
      ${where}
      GROUP BY date
      ORDER BY date;
    `;

    const r = await dbQuery(sql, params);
    // convert total_amount to number for frontend
    const out = r.rows.map(r => ({ date: r.date, count: Number(r.count), total_amount: Number(r.total_amount) }));
    res.json(out);
  } catch (e) { next(e); }
}