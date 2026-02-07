import { loadConfig } from "./config";
import { AppDb } from "./db";
import { errorResponse } from "./lib/http";
import { createLoggers } from "./logger";
import { handleFetch } from "./routes/fetch";
import { handleHealthz } from "./routes/healthz";
import { handleSearch } from "./routes/search";
import type { ServerContext } from "./server-context";
import { BraveClient } from "./services/brave-client";
import { ContentFetcher } from "./services/content-fetcher";
import { LlmJudge } from "./services/llm-judge";

const config = loadConfig();
const loggers = createLoggers(config);
const db = new AppDb(config.dbPath);
const braveClient = new BraveClient(config);
const contentFetcher = new ContentFetcher(config);
const llmJudge = new LlmJudge(config, loggers.app);

const ctx: ServerContext = {
  config,
  db,
  loggers,
  braveClient,
  contentFetcher,
  llmJudge,
};

setInterval(() => {
  try {
    db.purgeExpiredData(config.retentionDays);
  } catch (error) {
    loggers.app.error({ error }, "failed to purge expired data");
  }
}, 30 * 60 * 1000);

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: async (request) => {
    const started = Date.now();
    const { pathname } = new URL(request.url);

    let response: Response;

    if (pathname === "/healthz") {
      response = handleHealthz(request, ctx);
    } else if (pathname === "/v1/search") {
      if (request.method !== "POST") {
        response = errorResponse(405, "Method not allowed");
      } else {
        response = await handleSearch(request, ctx);
      }
    } else if (pathname === "/v1/fetch") {
      if (request.method !== "POST") {
        response = errorResponse(405, "Method not allowed");
      } else {
        response = await handleFetch(request, ctx);
      }
    } else {
      response = errorResponse(404, "Route not found");
    }

    loggers.app.info(
      {
        method: request.method,
        pathname,
        status: response.status,
        durationMs: Date.now() - started,
      },
      "http request",
    );

    return response;
  },
});

loggers.app.info(
  {
    host: server.hostname,
    port: server.port,
    profile: config.profile,
    llmJudgeEnabled: config.llmJudgeEnabled,
    allowlistSize: config.allowlistDomains.length,
    blocklistSize: config.blocklistDomains.length,
    websiteRendererBackend: config.websiteRendererBackend,
  },
  "claw-rubber started",
);

console.log(`claw-rubber listening on http://${server.hostname}:${server.port}`);
