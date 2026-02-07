import { expect } from "bun:test";
import { integration } from "./helpers";

integration.test("integration: /v1/search rejects GET with 405", async () => {
  const response = await fetch(integration.url("/v1/search"), {
    method: "GET",
    headers: integration.headers(false),
  });

  expect(response.status).toBe(405);
});

integration.test("integration: unknown route returns 404", async () => {
  const response = await fetch(integration.url("/v1/does-not-exist"), {
    method: "GET",
    headers: integration.headers(false),
  });

  expect(response.status).toBe(404);
});
