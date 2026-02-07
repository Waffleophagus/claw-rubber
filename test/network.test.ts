import { describe, expect, test } from "bun:test"
import { assertPublicHost, isPrivateIp } from "../src/lib/network"

describe("network safeguards", () => {
  test("blocks private and reserved IPv4 ranges", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true)
    expect(isPrivateIp("10.1.2.3")).toBe(true)
    expect(isPrivateIp("172.16.5.10")).toBe(true)
    expect(isPrivateIp("192.168.5.10")).toBe(true)
    expect(isPrivateIp("100.64.0.1")).toBe(true)
    expect(isPrivateIp("198.18.0.9")).toBe(true)
    expect(isPrivateIp("203.0.113.4")).toBe(true)
    expect(isPrivateIp("8.8.8.8")).toBe(false)
  })

  test("blocks private and reserved IPv6 ranges", () => {
    expect(isPrivateIp("::1")).toBe(true)
    expect(isPrivateIp("fc00::1")).toBe(true)
    expect(isPrivateIp("fd12:3456::1")).toBe(true)
    expect(isPrivateIp("fe80::1")).toBe(true)
    expect(isPrivateIp("2001:db8::1")).toBe(true)
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false)
  })

  test("blocks IPv4-mapped private IPv6 addresses", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true)
  })

  test("assertPublicHost rejects private literal hosts", async () => {
    await expect(assertPublicHost("127.0.0.1")).rejects.toThrow("not a public IP")
    await expect(assertPublicHost("::1")).rejects.toThrow("not a public IP")
  })
})
