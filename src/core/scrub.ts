const FIELD_NAME_PATTERN = /hdnStudId|userID|IP_ADDRESS|MAC_ADDRESS/gi;

const IPV4_PATTERN =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

const MAC_COLON_PATTERN = /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi;

const MAC_HYPHEN_PATTERN = /\b[0-9a-f]{2}(?:-[0-9a-f]{2}){5}\b/gi;

const MAC_BARE_PATTERN = /\b[0-9a-f]{12}\b/gi;

export function findScrubViolations(html: string): string[] {
  const violations: string[] = [];

  for (const match of html.matchAll(FIELD_NAME_PATTERN)) {
    violations.push(`student-identifying field name "${match[0]}"`);
  }

  for (const match of html.matchAll(IPV4_PATTERN)) {
    violations.push(`IPv4-shaped value "${match[0]}"`);
  }

  for (const pattern of [MAC_COLON_PATTERN, MAC_HYPHEN_PATTERN, MAC_BARE_PATTERN]) {
    for (const match of html.matchAll(pattern)) {
      violations.push(`MAC-shaped value "${match[0]}"`);
    }
  }

  return violations;
}
