import { expect } from "bun:test"
import { integration } from "./helpers"

integration.test("integration: /healthz responds with status ok", async () => {
  const response = await fetch(integration.url("/healthz"), {
    method: "GET",
    headers: integration.headers(false),
  })

  expect(response.ok).toBe(true)

  const payload = (await response.json()) as {
    status?: string
    checks?: Record<string, unknown>
  }

  expect(payload.status).toBe("ok")
  expect(typeof payload.checks).toBe("object")
})
