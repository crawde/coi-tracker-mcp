# coi-tracker-mcp

MCP server for COI (Certificate of Insurance) tracking and compliance verification.

Analyze certificates of insurance, check expiration dates, verify coverage against industry requirements, and identify compliance gaps — directly from your AI assistant.

## Installation

```bash
npx coi-tracker-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coi-tracker": {
      "command": "npx",
      "args": ["-y", "coi-tracker-mcp"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "coi-tracker": {
      "command": "npx",
      "args": ["-y", "coi-tracker-mcp"]
    }
  }
}
```

## Tools

### analyze_coi

Parse a Certificate of Insurance and extract structured data — named insured, coverage types, policy numbers, limits, expiration dates, and compliance flags.

**Input:**
- `text` (string, required) — Full text content of the COI document

### check_coi_expiration

Check if a policy is expired or expiring soon with urgency assessment and recommended actions.

**Input:**
- `expirationDate` (string, required) — Policy expiration date (e.g. "03/15/2026")
- `coverageType` (string, optional) — Type of coverage
- `vendorName` (string, optional) — Vendor name for context

### coi_requirements

Get standard COI requirements for an industry — required coverages, minimum limits, and endorsements.

**Input:**
- `industry` (enum, required) — One of: construction, technology, healthcare, real-estate, manufacturing
- `projectValue` (string, optional) — Approximate project value for limit recommendations

### verify_coi_compliance

Cross-reference a vendor's COI against industry requirements. Identifies coverage gaps, expired policies, and generates a compliance score.

**Input:**
- `coiText` (string, required) — Full COI text
- `industry` (enum, required) — Industry standard to verify against
- `additionalRequirements` (string, optional) — Extra requirements beyond industry standard

### coi_info

Get information about COI management best practices, ACORD 25 forms, and common compliance failures.

## Use Cases

- **Construction GCs** — Verify subcontractor insurance before mobilization
- **Property Managers** — Track vendor COI expirations across portfolios
- **Procurement Teams** — Validate supplier coverage meets contract requirements
- **Risk Managers** — Audit vendor insurance compliance at scale
- **Legal/Compliance** — Verify Additional Insured and Waiver of Subrogation endorsements

## Full Platform

For automated COI management with PDF upload, AI extraction, vendor self-service portal, team dashboards, and expiration alerts, visit [VendorShield](https://vendorshield.app).

## License

MIT
