import { expect } from "bun:test";
import { integrationHeaders, integrationTest, integrationUrl } from "./helpers";

integrationTest("integration: /healthz responds with status ok", async () => {
  const response = await fetch(integrationUrl("/healthz"), {
    method: "GET",
    headers: integrationHeaders(false),
  });

  expect(response.ok).toBe(true);

  const payload = await response.json() as {
    status?: string;
    checks?: Record<string, unknown>;
  };

  expect(payload.status).toBe("ok");
  expect(typeof payload.checks).toBe("object");
});
