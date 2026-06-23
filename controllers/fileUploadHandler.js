import fs from "fs";
import path from "path";
import { logger } from "../logger.js";

/**
 * Saves uploaded file buffer to disk and returns file metadata.
 */
export async function saveFileAndGetMetadata(file) {
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
  const savedPath = path.join(uploadsDir, safeName);

  await fs.promises.writeFile(savedPath, file.buffer);

  const file_path = path.relative(process.cwd(), savedPath).split(path.sep).join("/");
  
  logger.info(`File saved: ${file_path} size: ${file.size}`);

  return {
    file_name: file.originalname,
    file_type: file.mimetype || "application/octet-stream",
    file_size: Number(file.size || 0),
    file_path,
    uploaded_at: new Date(),
  };
}
