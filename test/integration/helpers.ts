import { test } from "bun:test";

export const BASE_URL = process.env.CLAWRUBBER_INTEGRATION_BASE_URL?.replace(/\/$/, "");
export const AUTH_BEARER = process.env.CLAWRUBBER_INTEGRATION_BEARER_TOKEN;

export const integrationTest = BASE_URL ? test : test.skip;

export function integrationHeaders(contentType = true): Record<string, string> {
  const headers: Record<string, string> = {};

  if (contentType) {
    headers["content-type"] = "application/json";
  }

  if (AUTH_BEARER) {
    headers.authorization = `Bearer ${AUTH_BEARER}`;
  }

  return headers;
}

export function integrationUrl(path: string): string {
  if (!BASE_URL) {
    return "http://localhost";
  }

  return `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
