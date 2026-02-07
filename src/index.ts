import { loadConfig } from "./config"
import { AppDb } from "./db"
import { errorResponse } from "./lib/http"
import { createLoggers } from "./logger"
import {
  handleDashboardAllowlistGet,
  handleDashboardAllowlistPost,
  handleDashboardEventDetail,
  handleDashboardEvents,
  handleDashboardOverview,
  handleDashboardTopAllowedBy,
  handleDashboardTimeseries,
  handleDashboardTraces,
  handleDashboardTopDomains,
  handleDashboardTopFlags,
  handleDashboardTopReasons,
} from "./routes/dashboard"
import { handleFetch } from "./routes/fetch"
import { handleHealthz } from "./routes/healthz"
import { handleSearch } from "./routes/search"
import { handleWebFetch } from "./routes/web-fetch"
import type { ServerContext } from "./server-context"
import { BraveClient } from "./services/brave-client"
import { ContentFetcher } from "./services/content-fetcher"
import { LlmJudge } from "./services/llm-judge"
import dashboardV1 from "./dashboard/v1/index.html"

const config = loadConfig()
const loggers = createLoggers(config)
const db = new AppDb(config.dbPath)
const braveClient = new BraveClient(config)
const contentFetcher = new ContentFetcher(config)
const llmJudge = new LlmJudge(config, loggers.app)

const ctx: ServerContext = {
  config,
  db,
  loggers,
  braveClient,
  contentFetcher,
  llmJudge,
}

setInterval(
  () => {
    try {
      db.purgeExpiredData(config.retentionDays)
    } catch (error) {
      loggers.app.error({ error }, "failed to purge expired data")
    }
  },
  30 * 60 * 1000,
)

const server = Bun.serve({
  routes: {
    "/dashboard": dashboardV1,
    "/dashboard/": dashboardV1,
    "/dashboard/v1": dashboardV1,
    "/dashboard/v1/": dashboardV1,
  },
  hostname: config.host,
  port: config.port,
  fetch: async (request) => {
    const started = Date.now()
    const { pathname } = new URL(request.url)

    let response: Response

    if (pathname === "/healthz") {
      response = handleHealthz(request, ctx)
    } else if (pathname === "/v1/search") {
      if (request.method !== "POST") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = await handleSearch(request, ctx)
      }
    } else if (pathname === "/v1/fetch") {
      if (request.method !== "POST") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = await handleFetch(request, ctx)
      }
    } else if (pathname === "/v1/web-fetch") {
      if (request.method !== "POST") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = await handleWebFetch(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/overview") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardOverview(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/events") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardEvents(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/traces") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardTraces(request, ctx)
      }
    } else if (pathname.startsWith("/v1/dashboard/events/")) {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardEventDetail(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/timeseries") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardTimeseries(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/top-domains") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardTopDomains(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/top-flags") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardTopFlags(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/top-reasons") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardTopReasons(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/top-allowed-by") {
      if (request.method !== "GET") {
        response = errorResponse(405, "Method not allowed")
      } else {
        response = handleDashboardTopAllowedBy(request, ctx)
      }
    } else if (pathname === "/v1/dashboard/allowlist") {
      if (request.method === "GET") {
        response = await handleDashboardAllowlistGet(request, ctx)
      } else if (request.method === "POST") {
        response = await handleDashboardAllowlistPost(request, ctx)
      } else {
        response = errorResponse(405, "Method not allowed")
      }
    } else {
      response = errorResponse(404, "Route not found")
    }

    loggers.app.info(
      {
        method: request.method,
        pathname,
        status: response.status,
        durationMs: Date.now() - started,
      },
      "http request",
    )

    return response
  },
})

loggers.app.info(
  {
    host: server.hostname,
    port: server.port,
    profile: config.profile,
    llmJudgeEnabled: config.llmJudgeEnabled,
    allowlistSize: config.allowlistDomains.length,
    languageAllowlistExtraSize: config.languageNameAllowlistExtra.length,
    blocklistSize: config.blocklistDomains.length,
    websiteRendererBackend: config.websiteRendererBackend,
    braveRateLimitTier: config.braveRateLimit.tier,
    braveRateLimitRps: config.braveRateLimit.requestsPerSecond,
    braveQueueMax: config.braveRateLimit.queueMax,
  },
  "claw-rubber started",
)

console.log(`claw-rubber listening on http://${server.hostname}:${server.port}`)
