import { expect, test } from "bun:test";
import { loadConfig } from "../src/config";

test("uses none renderer backend by default", () => {
  const config = loadConfig({});

  expect(config.websiteRendererBackend).toBe("none");
  expect(config.browserless.baseUrl).toBe("http://browserless:3000");
  expect(config.browserless.fallbackToHttp).toBe(true);
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
