import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

interface CidrRange {
  family: 4 | 6
  network: bigint
  prefix: number
  mask: bigint
}

const BLOCKED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]

const BLOCKED_IPV6_CIDRS = [
  "::/128",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
  "2001:db8::/32",
]

const PARSED_IPV4_CIDRS = BLOCKED_IPV4_CIDRS.map((cidr) => parseCidr(cidr, 4))
const PARSED_IPV6_CIDRS = BLOCKED_IPV6_CIDRS.map((cidr) => parseCidr(cidr, 6))

export function isPrivateIp(ip: string): boolean {
  const parsed = parseIp(ip)
  if (!parsed) {
    return true
  }

  if (parsed.family === 4) {
    return PARSED_IPV4_CIDRS.some((range) => cidrContains(range, parsed.value))
  }

  if (parsed.ipv4Mapped !== null) {
    return PARSED_IPV4_CIDRS.some((range) => cidrContains(range, parsed.ipv4Mapped!))
  }

  return PARSED_IPV6_CIDRS.some((range) => cidrContains(range, parsed.value))
}

export async function assertPublicHost(host: string): Promise<void> {
  const literalFamily = isIP(host)
  if (literalFamily !== 0) {
    if (isPrivateIp(host)) {
      throw new Error(`Host ${host} is not a public IP address`)
    }
    return
  }

  const addresses = await lookup(host, { all: true, verbatim: true })
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host ${host}`)
  }

  for (const resolved of addresses) {
    if (isPrivateIp(resolved.address)) {
      throw new Error(`Resolved non-public address ${resolved.address} for host ${host}`)
    }
  }
}

function parseIp(
  input: string,
): { family: 4 | 6; value: bigint; ipv4Mapped: bigint | null } | null {
  const family = isIP(input)
  if (family === 4) {
    const parsed = parseIpv4(input)
    if (parsed === null) {
      return null
    }
    return { family: 4, value: parsed, ipv4Mapped: null }
  }

  if (family === 6) {
    const parsed = parseIpv6(input)
    if (parsed === null) {
      return null
    }
    const mapped = parsed >> 32n === 0xffffn ? parsed & 0xffff_ffffn : null
    return { family: 6, value: parsed, ipv4Mapped: mapped }
  }

  return null
}

function parseCidr(value: string, expectedFamily: 4 | 6): CidrRange {
  const [ip, prefixRaw] = value.split("/")
  if (!ip || !prefixRaw) {
    throw new Error(`Invalid CIDR range: ${value}`)
  }

  const prefix = Number.parseInt(prefixRaw, 10)
  if (!Number.isInteger(prefix)) {
    throw new Error(`Invalid CIDR prefix: ${value}`)
  }

  const parsed = parseIp(ip)
  if (!parsed || parsed.family !== expectedFamily) {
    throw new Error(`Invalid CIDR base address: ${value}`)
  }

  const width = expectedFamily === 4 ? 32 : 128
  if (prefix < 0 || prefix > width) {
    throw new Error(`CIDR prefix out of range: ${value}`)
  }

  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(width - prefix)
  return {
    family: expectedFamily,
    network: parsed.value & mask,
    prefix,
    mask,
  }
}

function cidrContains(range: CidrRange, value: bigint): boolean {
  if (range.prefix === 0) {
    return true
  }

  return (value & range.mask) === range.network
}

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split(".")
  if (parts.length !== 4) {
    return null
  }

  let value = 0n
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null
    }
    const octet = Number.parseInt(part, 10)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null
    }
    value = (value << 8n) | BigInt(octet)
  }

  return value
}

function parseIpv6(ip: string): bigint | null {
  const normalized = ip.split("%")[0]?.toLowerCase() ?? ""
  if (!normalized) {
    return null
  }

  const doubleColonParts = normalized.split("::")
  if (doubleColonParts.length > 2) {
    return null
  }

  const leftRaw = doubleColonParts[0] ? doubleColonParts[0].split(":") : []
  const rightRaw = doubleColonParts[1] ? doubleColonParts[1].split(":") : []

  const left = expandIpv6Parts(leftRaw)
  const right = expandIpv6Parts(rightRaw)
  if (!left || !right) {
    return null
  }

  const groups =
    doubleColonParts.length === 2
      ? [...left, ...new Array(8 - left.length - right.length).fill(0), ...right]
      : left

  if (groups.length !== 8) {
    return null
  }

  let value = 0n
  for (const group of groups) {
    value = (value << 16n) | BigInt(group)
  }

  return value
}

function expandIpv6Parts(parts: string[]): number[] | null {
  const groups: number[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part) {
      return null
    }

    if (part.includes(".")) {
      if (index !== parts.length - 1) {
        return null
      }
      const ipv4 = parseIpv4(part)
      if (ipv4 === null) {
        return null
      }
      groups.push(Number((ipv4 >> 16n) & 0xffffn))
      groups.push(Number(ipv4 & 0xffffn))
      continue
    }

    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return null
    }

    groups.push(Number.parseInt(part, 16))
  }

  return groups
}
