// db.js
import pkg from "pg";
import dotenv from "dotenv";
import { logger } from "../logger.js";
dotenv.config();

const { Pool } = pkg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

pool.on("error", (err) => {
  logger.error(`Postgres pool error: ${err?.message || err}`);
});

export async function dbQuery(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms = Date.now() - start;
    logger.info(`DB OK (${ms}ms): ${text.replace(/\s+/g, " ").trim()} -- params=${JSON.stringify(params)}`);
    return res;
  } catch (err) {
    const ms = Date.now() - start;
    logger.error(`DB ERR (${ms}ms): ${text.replace(/\s+/g, " ").trim()} -- params=${JSON.stringify(params)} -- error=${err.message}`);
    throw err;
  }
}
