import { expect } from "bun:test";
import { integrationHeaders, integrationTest, integrationUrl } from "./helpers";

integrationTest("integration: /v1/web-fetch contract", async () => {
  const response = await fetch(integrationUrl("/v1/web-fetch"), {
    method: "POST",
    headers: integrationHeaders(),
    body: JSON.stringify({
      url: "https://example.com",
      extractMode: "markdown",
    }),
  });

  expect([200, 422]).toContain(response.status);

  const payload = await response.json() as {
    fetch_id?: string;
    url?: string;
    extract_mode?: "text" | "markdown";
    content?: string;
    truncated?: boolean;
    safety?: {
      decision?: "allow" | "block";
    };
  };

  expect(typeof payload.fetch_id).toBe("string");
  expect(payload.url).toBe("https://example.com/");
  expect(payload.extract_mode).toBe("markdown");
  expect(typeof payload.safety?.decision).toBe("string");

  if (response.status === 200) {
    expect(typeof payload.content).toBe("string");
    expect(payload.content!.length).toBeGreaterThan(0);
    expect(payload.truncated).toBe(false);
  }
});

integrationTest("integration: /v1/web-fetch maxChars truncation", async () => {
  const response = await fetch(integrationUrl("/v1/web-fetch"), {
    method: "POST",
    headers: integrationHeaders(),
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
