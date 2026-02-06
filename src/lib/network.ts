import { lookup } from "node:dns/promises";

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
];

const PRIVATE_IPV6_PATTERNS: RegExp[] = [
  /^::1$/i,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(".")) {
    return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(ip));
  }

  return PRIVATE_IPV6_PATTERNS.some((pattern) => pattern.test(ip));
}

export async function assertPublicHost(host: string): Promise<void> {
  const { address } = await lookup(host, { all: false, verbatim: true });

  if (isPrivateIp(address)) {
    throw new Error(`Resolved private address for host ${host}`);
  }
}
