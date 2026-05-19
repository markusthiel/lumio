/**
 * Lumio API — Pino Logger
 *
 * Wir geben Fastify die Logger-OPTIONEN, nicht eine fertige Instanz —
 * das vermeidet Type-Konflikte zwischen pino und Fastifys eigenen Logger-Types.
 * Für direkte Logger-Verwendung außerhalb von Fastify (z.B. bootstrap.ts)
 * exportieren wir zusätzlich eine eigene Pino-Instanz.
 */
import pino, { type LoggerOptions } from "pino";
import { config } from "./config.js";

export const loggerOptions: LoggerOptions = {
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
};

export const logger = pino(loggerOptions);
