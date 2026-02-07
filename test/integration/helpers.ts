import { test } from "bun:test";
import { integrationTestConfig, type IntegrationTestConfig } from "./config";

export interface ResolvedIntegrationConfig {
  baseUrl: string;
  bearerToken: string;
  searchQuery: string;
  webFetchTargetUrl: string;
  languageAllowlistExtras: string[];
  integrationEnabled: boolean;
  integrationDisabledReason?: string;
}

export class IntegrationHarness {
  readonly config: ResolvedIntegrationConfig;
  readonly test: typeof test;

  constructor(config: ResolvedIntegrationConfig) {
    this.config = config;
    this.test = (config.integrationEnabled ? test : test.skip) as typeof test;
  }

  headers(contentType = true): Record<string, string> {
    const headers: Record<string, string> = {};

    if (contentType) {
      headers["content-type"] = "application/json";
    }

    if (this.config.bearerToken) {
      headers.authorization = `Bearer ${this.config.bearerToken}`;
    }

    return headers;
  }

  url(path: string): string {
    if (!this.config.integrationEnabled) {
      throw new Error(
        `Integration tests are disabled: ${this.config.integrationDisabledReason ?? "set integration base URL"}`,
      );
    }
    return `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  languageAllowlistExtraCsv(): string {
    return this.config.languageAllowlistExtras.join(",");
  }
}

const DEFAULT_CONFIG = resolveIntegrationConfig(process.env, integrationTestConfig);
export const integration = new IntegrationHarness(DEFAULT_CONFIG);

// Backwards-compatible exports for existing integration tests.
export const integrationTest = integration.test;
export function integrationHeaders(contentType = true): Record<string, string> {
  return integration.headers(contentType);
}

export function integrationUrl(path: string): string {
  return integration.url(path);
}

function resolveIntegrationConfig(
  env: Record<string, string | undefined>,
  fileConfig: IntegrationTestConfig,
): ResolvedIntegrationConfig {
  const rawBaseUrl = (env.CLAWRUBBER_INTEGRATION_BASE_URL ?? fileConfig.baseUrl).trim();
  const baseUrlResolution = normalizeBaseUrl(rawBaseUrl);
  const bearerToken = (env.CLAWRUBBER_INTEGRATION_BEARER_TOKEN ?? fileConfig.bearerToken).trim();
  const searchQuery = (env.CLAWRUBBER_INTEGRATION_SEARCH_QUERY ?? fileConfig.searchQuery).trim();
  const webFetchTargetUrl = (env.CLAWRUBBER_INTEGRATION_WEB_FETCH_URL ?? fileConfig.webFetchTargetUrl).trim();
  const envLanguageExtras = parseCsv(env.CLAWRUBBER_INTEGRATION_LANGUAGE_ALLOWLIST_EXTRA);
  const languageAllowlistExtras = envLanguageExtras.length > 0
    ? envLanguageExtras
    : fileConfig.languageAllowlistExtras.map((item) => item.trim()).filter((item) => item.length > 0);

  return {
    baseUrl: baseUrlResolution.baseUrl,
    bearerToken,
    searchQuery,
    webFetchTargetUrl,
    languageAllowlistExtras,
    integrationEnabled: baseUrlResolution.integrationEnabled,
    integrationDisabledReason: baseUrlResolution.integrationDisabledReason,
  };
}

function normalizeBaseUrl(raw: string): {
  baseUrl: string;
  integrationEnabled: boolean;
  integrationDisabledReason?: string;
} {
  if (!raw) {
    return {
      baseUrl: "",
      integrationEnabled: false,
      integrationDisabledReason: "set test/integration/config.ts baseUrl or CLAWRUBBER_INTEGRATION_BASE_URL",
    };
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `${defaultSchemeForHost(raw)}://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        baseUrl: "",
        integrationEnabled: false,
        integrationDisabledReason: `unsupported base URL protocol: ${parsed.protocol}`,
      };
    }

    return {
      baseUrl: parsed.toString().replace(/\/$/, ""),
      integrationEnabled: true,
    };
  } catch {
    return {
      baseUrl: "",
      integrationEnabled: false,
      integrationDisabledReason: `invalid base URL: ${raw}`,
    };
  }
}

function defaultSchemeForHost(raw: string): "http" | "https" {
  const host = raw.split("/")[0]?.toLowerCase() ?? "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]")) {
    return "http";
  }

  return "https";
}

function parseCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }

  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
