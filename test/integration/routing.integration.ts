import { expect } from "bun:test";
import { integrationHeaders, integrationTest, integrationUrl } from "./helpers";

integrationTest("integration: /v1/search rejects GET with 405", async () => {
  const response = await fetch(integrationUrl("/v1/search"), {
    method: "GET",
    headers: integrationHeaders(false),
  });

  expect(response.status).toBe(405);
});

integrationTest("integration: unknown route returns 404", async () => {
  const response = await fetch(integrationUrl("/v1/does-not-exist"), {
    method: "GET",
    headers: integrationHeaders(false),
  });

  expect(response.status).toBe(404);
});
