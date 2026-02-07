import { expect } from "bun:test"
import { integration } from "./helpers"

interface SearchResult {
  result_id: string
  availability: "allowed" | "blocked"
}

interface SearchResponse {
  request_id: string
  results: SearchResult[]
}

integration.test("integration: /v1/search then /v1/fetch roundtrip", async () => {
  const searchResponse = await fetch(integration.url("/v1/search"), {
    method: "POST",
    headers: integration.headers(),
    body: JSON.stringify({
      query: integration.config.searchQuery,
      count: 5,
      safesearch: "moderate",
    }),
  })

  expect(searchResponse.ok).toBe(true)

  const searchPayload = (await searchResponse.json()) as SearchResponse
  expect(typeof searchPayload.request_id).toBe("string")
  expect(Array.isArray(searchPayload.results)).toBe(true)
  expect(searchPayload.results.length).toBeGreaterThan(0)

  const allowedResult = searchPayload.results.find((result) => result.availability === "allowed")
  expect(allowedResult).toBeDefined()

  const fetchResponse = await fetch(integration.url("/v1/fetch"), {
    method: "POST",
    headers: integration.headers(),
    body: JSON.stringify({
      result_id: allowedResult!.result_id,
    }),
  })

  expect([200, 422]).toContain(fetchResponse.status)

  const fetchPayload = (await fetchResponse.json()) as {
    result_id?: string
    content?: string
    safety?: {
      decision?: "allow" | "block"
      flags?: string[]
    }
  }

  expect(fetchPayload.result_id).toBe(allowedResult!.result_id)
  expect(typeof fetchPayload.safety?.decision).toBe("string")

  if (fetchResponse.status === 200) {
    expect(typeof fetchPayload.content).toBe("string")
    expect(fetchPayload.content!.length).toBeGreaterThan(0)
  }
})
