import { expect } from "bun:test";
import { integration } from "./helpers";

integration.test("integration: /v1/web-fetch contract", async () => {
  const response = await fetch(integration.url("/v1/web-fetch"), {
    method: "POST",
    headers: integration.headers(),
    body: JSON.stringify({
      url: "https://example.com",
      extractMode: "markdown",
    }),
  });

  expect([200, 422]).toContain(response.status);

  const payload = await response.json() as {
    fetch_id?: string;
    url?: string;
    final_url?: string;
    extract_mode?: "text" | "markdown";
    content?: string;
    truncated?: boolean;
    safety?: {
      decision?: "allow" | "block";
    };
  };

  expect(typeof payload.fetch_id).toBe("string");
  expect(payload.extract_mode).toBe("markdown");
  expect(typeof payload.safety?.decision).toBe("string");

  if (response.status === 200) {
    expect(payload.url).toBe("https://example.com/");
    expect(typeof payload.final_url).toBe("string");
    expect(typeof payload.content).toBe("string");
    expect(payload.content!.length).toBeGreaterThan(0);
    expect(payload.truncated).toBe(false);
  }
});

integration.test("integration: /v1/web-fetch maxChars truncation", async () => {
  const response = await fetch(integration.url("/v1/web-fetch"), {
    method: "POST",
    headers: integration.headers(),
    body: JSON.stringify({
      url: "https://example.com",
      extractMode: "text",
      maxChars: 80,
    }),
  });

  expect([200, 422]).toContain(response.status);

  const payload = await response.json() as {
    content?: string;
    truncated?: boolean;
    safety?: {
      decision?: "allow" | "block";
    };
  };

  if (response.status === 200) {
    expect(payload.content?.length).toBeLessThanOrEqual(80);
    expect(payload.truncated).toBe(true);
  } else {
    expect(payload.safety?.decision).toBe("block");
  }
});

integration.test("integration: /v1/web-fetch wikipedia victorian architecture diagnostics", async () => {
  const targetUrl = integration.config.webFetchTargetUrl;
  const response = await fetch(integration.url("/v1/web-fetch"), {
    method: "POST",
    headers: integration.headers(),
    body: JSON.stringify({
      url: targetUrl,
      extractMode: "text",
      maxChars: 12_000,
    }),
  });

  expect([200, 422]).toContain(response.status);

  const payload = await response.json() as {
    safety?: {
      decision?: "allow" | "block";
      reason?: string;
      score?: number;
      flags?: string[];
      obfuscation_signals?: string[];
    };
    source?: {
      domain?: string;
      fetch_backend?: string;
      rendered?: boolean;
      fallback_used?: boolean;
      final_url?: string;
    };
    content?: string;
  };

  if (response.status === 200) {
    expect(payload.safety?.decision).toBe("allow");
    expect(typeof payload.content).toBe("string");
    expect(payload.content!.length).toBeGreaterThan(400);
    return;
  }

  expect(payload.safety?.decision).toBe("block");
  console.warn(
    "[integration diagnostics] wikipedia page blocked",
    JSON.stringify({
      url: targetUrl,
      status: response.status,
      reason: payload.safety?.reason ?? null,
      score: payload.safety?.score ?? null,
      flags: payload.safety?.flags ?? [],
      obfuscation_signals: payload.safety?.obfuscation_signals ?? [],
      configured_language_allowlist_extras: integration.config.languageAllowlistExtras,
      suggested_server_env: integration.languageAllowlistExtraCsv().length > 0
        ? `CLAWRUBBER_LANGUAGE_NAME_ALLOWLIST_EXTRA=${integration.languageAllowlistExtraCsv()}`
        : null,
      source: payload.source ?? null,
    }),
  );
});
