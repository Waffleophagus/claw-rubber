import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pino from "pino";
import { createStream } from "rotating-file-stream";
import type { AppConfig } from "./config";

export interface Loggers {
  app: pino.Logger;
  security: pino.Logger;
}

export function createLoggers(config: AppConfig): Loggers {
  const resolvedLogDir = resolve(config.logDir);
  mkdirSync(resolvedLogDir, { recursive: true });
  mkdirSync(dirname(config.dbPath), { recursive: true });

  const appStream = createStream("app.log", {
    interval: "1d",
    size: "10M",
    rotate: 30,
    path: resolvedLogDir,
    compress: "gzip",
  });

  const securityStream = createStream("security.log", {
    interval: "1d",
    size: "10M",
    rotate: 60,
    path: resolvedLogDir,
    compress: "gzip",
  });

  const app = pino(
    {
      level: "info",
      base: {
        service: "claw-rubber",
        profile: config.profile,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    appStream,
  );

  const security = pino(
    {
      level: "info",
      base: {
        service: "claw-rubber-security",
        profile: config.profile,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    securityStream,
  );

  return { app, security };
}
