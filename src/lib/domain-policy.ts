export type DomainPolicyAction = "allow-bypass" | "block" | "inspect";

export interface DomainPolicyResult {
  domain: string;
  action: DomainPolicyAction;
  reason?: string;
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

export function hostMatchesRule(host: string, rule: string): boolean {
  const normalizedHost = normalizeDomain(host);
  const normalizedRule = normalizeDomain(rule);

  return normalizedHost === normalizedRule || normalizedHost.endsWith(`.${normalizedRule}`);
}

export function evaluateDomainPolicy(host: string, allowlist: string[], blocklist: string[]): DomainPolicyResult {
  const domain = normalizeDomain(host);

  for (const blocked of blocklist) {
    if (hostMatchesRule(domain, blocked)) {
      return {
        domain,
        action: "block",
        reason: `Domain matched blocklist rule: ${blocked}`,
      };
    }
  }

  for (const allowed of allowlist) {
    if (hostMatchesRule(domain, allowed)) {
      return {
        domain,
        action: "allow-bypass",
        reason: `Domain matched allowlist rule: ${allowed}`,
      };
    }
  }

  return {
    domain,
    action: "inspect",
  };
}
