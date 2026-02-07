import { describe, expect, test } from "bun:test"
import { evaluateDomainPolicy, hostMatchesRule } from "../src/lib/domain-policy"

describe("domain policy", () => {
  test("matches root and subdomains", () => {
    expect(hostMatchesRule("example.com", "example.com")).toBe(true)
    expect(hostMatchesRule("docs.example.com", "example.com")).toBe(true)
    expect(hostMatchesRule("example.net", "example.com")).toBe(false)
  })

  test("blocklist takes priority", () => {
    const decision = evaluateDomainPolicy("docs.example.com", ["example.com"], ["docs.example.com"])

    expect(decision.action).toBe("block")
  })

  test("allowlist bypass when not blocked", () => {
    const decision = evaluateDomainPolicy("docs.example.com", ["example.com"], ["bad.example.com"])

    expect(decision.action).toBe("allow-bypass")
  })
})
