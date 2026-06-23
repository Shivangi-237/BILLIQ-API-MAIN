// authMiddleware.js
import dotenv from "dotenv";
dotenv.config();

export default function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "");
  const expected = process.env.API_STATIC_TOKEN || "supersecrettoken123";
  if (!token) return res.status(401).json({ ok: false, error: "missing token" });
  if (token !== expected) return res.status(403).json({ ok: false, error: "invalid token" });
  req.user = { email: "demo@billiq.app" };
  next();
}


