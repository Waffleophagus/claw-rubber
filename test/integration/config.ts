export interface IntegrationTestConfig {
  // Set your running proxy URL here once, e.g. "http://localhost:3000" or "https://proxy.example.com".
  baseUrl: string;
  // Optional bearer token for authenticated deployments.
  bearerToken: string;
  // Default query for search/fetch roundtrip tests.
  searchQuery: string;
  // Target URL for web-fetch diagnostics test.
  webFetchTargetUrl: string;
  // Personal language dictionary ideas for experimenting with allowlist behavior.
  // These are test-side values for quick iteration and notes; server still uses
  // CLAWRUBBER_LANGUAGE_NAME_ALLOWLIST_EXTRA to activate runtime behavior.
  languageAllowlistExtras: string[];
}

export const integrationTestConfig: IntegrationTestConfig = {
  baseUrl: "",
  bearerToken: "",
  searchQuery: "bun runtime docs",
  webFetchTargetUrl: "https://en.wikipedia.org/wiki/Victorian_architecture",
  languageAllowlistExtras: [
    "english",
    "español",
    "русский",
    "العربية",
  ],
};
