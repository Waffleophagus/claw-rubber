import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { handleSearch } from "../src/routes/search";
import type { ServerContext } from "../src/server-context";
import { QueueOverflowError } from "../src/services/rate-limiter";

test("search route returns 503 when brave queue is full", async () => {
  const request = new Request("http://localhost/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "bun docs",
      count: 1,
    }),
  });

  const ctx = {
    config: loadConfig({ CLAWRUBBER_BRAVE_API_KEY: "test-key" }),
    db: {
      getEffectiveAllowlist: () => [],
    },
    loggers: {
      app: {
        info: () => {},
        error: () => {},
      },
      security: {
        info: () => {},
        error: () => {},
      },
    },
    braveClient: {
      webSearch: async () => {
        throw new QueueOverflowError("full");
      },
    },
    contentFetcher: {},
    llmJudge: {},
  } as unknown as ServerContext;

  const response = await handleSearch(request, ctx);
  const payload = await response.json() as { error?: { message?: string } };

  expect(response.status).toBe(503);
  expect(payload.error?.message).toBe("Search queue is full, retry shortly");
});
