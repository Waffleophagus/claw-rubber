import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

test("uses none renderer backend by default", () => {
  const config = loadConfig({});

  expect(config.websiteRendererBackend).toBe("none");
  expect(config.browserless.baseUrl).toBe("http://browserless:3000");
  expect(config.browserless.fallbackToHttp).toBe(true);
  expect(config.braveRateLimit.tier).toBe("free");
  expect(config.braveRateLimit.requestsPerSecond).toBe(1);
  expect(config.braveRateLimit.queueMax).toBe(10);
  expect(config.braveRateLimit.retryOn429).toBe(true);
  expect(config.braveRateLimit.retryMax).toBe(1);
  expect(config.exposeSafeContentUrls).toBe(true);
});

test("parses CLAWRUBBER renderer settings", () => {
  const config = loadConfig({
    CLAWRUBBER_WEBSITE_RENDERER_BACKEND: "browserless",
    CLAWRUBBER_BROWSERLESS_URL: "http://localhost:3100",
    CLAWRUBBER_BROWSERLESS_TOKEN: "secret",
    CLAWRUBBER_BROWSERLESS_TIMEOUT_MS: "21000",
    CLAWRUBBER_BROWSERLESS_WAIT_UNTIL: "domcontentloaded",
    CLAWRUBBER_BROWSERLESS_WAIT_FOR_SELECTOR: "main article",
    CLAWRUBBER_BROWSERLESS_MAX_HTML_BYTES: "420000",
    CLAWRUBBER_BROWSERLESS_FALLBACK_TO_HTTP: "false",
    CLAWRUBBER_BROWSERLESS_BLOCK_ADS: "false",
  });

  expect(config.websiteRendererBackend).toBe("browserless");
  expect(config.browserless.baseUrl).toBe("http://localhost:3100");
  expect(config.browserless.token).toBe("secret");
  expect(config.browserless.timeoutMs).toBe(21000);
  expect(config.browserless.waitUntil).toBe("domcontentloaded");
  expect(config.browserless.waitForSelector).toBe("main article");
  expect(config.browserless.maxHtmlBytes).toBe(420000);
  expect(config.browserless.fallbackToHttp).toBe(false);
  expect(config.browserless.blockAds).toBe(false);
});

test("parses brave rate limit tier and queue settings", () => {
  const config = loadConfig({
    CLAWRUBBER_RATE_LIMIT: "pro",
    CLAWRUBBER_BRAVE_QUEUE_MAX: "25",
    CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_ON_429: "false",
    CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_MAX: "3",
  });

  expect(config.braveRateLimit.tier).toBe("pro");
  expect(config.braveRateLimit.requestsPerSecond).toBe(50);
  expect(config.braveRateLimit.queueMax).toBe(25);
  expect(config.braveRateLimit.retryOn429).toBe(false);
  expect(config.braveRateLimit.retryMax).toBe(3);
});

test("uses explicit brave rate limit rps override and clamps invalid minimums", () => {
  const config = loadConfig({
    CLAWRUBBER_RATE_LIMIT: "7",
    CLAWRUBBER_BRAVE_QUEUE_MAX: "0",
    CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_MAX: "-9",
  });

  expect(config.braveRateLimit.tier).toBe("custom");
  expect(config.braveRateLimit.requestsPerSecond).toBe(7);
  expect(config.braveRateLimit.queueMax).toBe(1);
  expect(config.braveRateLimit.retryMax).toBe(0);
});

test("throws when CLAWRUBBER_RATE_LIMIT is invalid", () => {
  expect(() => loadConfig({
    CLAWRUBBER_RATE_LIMIT: "not-a-valid-rate-limit",
  })).toThrow();
});

test("parses extra language-name allowlist entries", () => {
  const config = loadConfig({
    CLAWRUBBER_LANGUAGE_NAME_ALLOWLIST_EXTRA: "Klingon, tlhIngan Hol, Klingon",
  });

  expect(config.languageNameAllowlistExtra).toEqual(["klingon", "tlhingan hol"]);
});

test("parses safe content URL exposure toggle", () => {
  const config = loadConfig({
    CLAWRUBBER_EXPOSE_SAFE_CONTENT_URLS: "false",
  });

  expect(config.exposeSafeContentUrls).toBe(false);
});
