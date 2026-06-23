// logger.js
import winston from "winston";

const { combine, timestamp, printf } = winston.format;
const logFormat = printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(timestamp(), logFormat),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/app.log", maxsize: 5 * 1024 * 1024 })
  ],
  exitOnError: false
});

export const stream = { write: (msg) => logger.info(msg.trim()) };
