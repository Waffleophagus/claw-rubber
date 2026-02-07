import { describe, expect, test } from "bun:test"
import { loadConfig } from "../src/config"
import { BraveClient } from "../src/services/brave-client"
import { QueueOverflowError } from "../src/services/rate-limiter"

function okBraveResponse(urlSuffix = "a"): Response {
  return new Response(
    JSON.stringify({
      web: {
        results: [
          {
            url: `https://example.com/${urlSuffix}`,
            title: `title-${urlSuffix}`,
            description: `snippet-${urlSuffix}`,
          },
        ],
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  )
}

describe("brave client rate limiting", () => {
  test("queues concurrent requests at configured rps", async () => {
    let nowMs = 0
    const startedAt: number[] = []

    const client = new BraveClient(
      loadConfig({
        CLAWRUBBER_BRAVE_API_KEY: "test-key",
        CLAWRUBBER_RATE_LIMIT: "1",
        CLAWRUBBER_BRAVE_QUEUE_MAX: "10",
        CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_ON_429: "false",
      }),
      {
        fetchImpl: async () => {
          startedAt.push(nowMs)
          return okBraveResponse()
        },
        now: () => nowMs,
        sleep: async (ms) => {
          nowMs += ms
        },
        random: () => 0,
      },
    )

    await Promise.all([
      client.webSearch({ query: "one", count: 1 }),
      client.webSearch({ query: "two", count: 1 }),
      client.webSearch({ query: "three", count: 1 }),
    ])

    expect(startedAt).toEqual([0, 1000, 2000])
  })

  test("rejects quickly when queue is saturated", async () => {
    let nowMs = 0
    let callCount = 0
    let resolveFirst!: (response: Response) => void

    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })

    const client = new BraveClient(
      loadConfig({
        CLAWRUBBER_BRAVE_API_KEY: "test-key",
        CLAWRUBBER_RATE_LIMIT: "1",
        CLAWRUBBER_BRAVE_QUEUE_MAX: "1",
        CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_ON_429: "false",
      }),
      {
        fetchImpl: async () => {
          callCount += 1
          if (callCount === 1) {
            return firstResponse
          }
          return okBraveResponse("queued")
        },
        now: () => nowMs,
        sleep: async (ms) => {
          nowMs += ms
        },
        random: () => 0,
      },
    )

    const first = client.webSearch({ query: "one", count: 1 })
    await Promise.resolve()
    const second = client.webSearch({ query: "two", count: 1 })
    const third = client.webSearch({ query: "three", count: 1 })

    await expect(third).rejects.toBeInstanceOf(QueueOverflowError)

    resolveFirst(okBraveResponse("first"))

    await first
    await second
  })

  test("retries once on 429 using rate-limit reset header", async () => {
    let nowMs = 0
    const sleeps: number[] = []
    let attempts = 0

    const client = new BraveClient(
      loadConfig({
        CLAWRUBBER_BRAVE_API_KEY: "test-key",
        CLAWRUBBER_RATE_LIMIT: "50",
        CLAWRUBBER_BRAVE_QUEUE_MAX: "10",
        CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_ON_429: "true",
        CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_MAX: "1",
      }),
      {
        fetchImpl: async () => {
          attempts += 1
          if (attempts === 1) {
            return new Response(JSON.stringify({ error: "rate limited" }), {
              status: 429,
              headers: {
                "content-type": "application/json",
                "x-ratelimit-reset": "1",
              },
            })
          }
          return okBraveResponse("retry")
        },
        now: () => nowMs,
        sleep: async (ms) => {
          sleeps.push(ms)
          nowMs += ms
        },
        random: () => 0,
      },
    )

    const result = await client.webSearch({ query: "retry", count: 1 })

    expect(attempts).toBe(2)
    expect(sleeps).toEqual([1000])
    expect(result.results.length).toBe(1)
    expect(result.results[0]?.title).toBe("title-retry")
  })
})
