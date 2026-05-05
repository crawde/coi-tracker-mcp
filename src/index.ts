#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const VENDORSHIELD_URL = "https://vendorshield.app";

// ── Coverage requirement databases ─────────────────────────────────────
const INDUSTRY_REQUIREMENTS: Record<
  string,
  { coverages: string[]; minimums: Record<string, string>; notes: string[] }
> = {
  construction: {
    coverages: [
      "Commercial General Liability",
      "Workers Compensation",
      "Commercial Auto Liability",
      "Umbrella/Excess Liability",
      "Professional Liability (E&O)",
      "Builders Risk",
    ],
    minimums: {
      "General Liability": "$1M per occurrence / $2M aggregate",
      "Workers Compensation": "Statutory limits",
      "Auto Liability": "$1M combined single limit",
      "Umbrella/Excess": "$5M per occurrence",
      "Professional Liability": "$1M per claim",
    },
    notes: [
      "Additional Insured endorsement required on GL and Auto",
      "Waiver of Subrogation required on Workers Comp and GL",
      "Primary & Non-Contributory wording required",
      "30-day notice of cancellation required",
      "Per-project aggregate endorsement recommended for large GCs",
    ],
  },
  technology: {
    coverages: [
      "Commercial General Liability",
      "Professional Liability (E&O)",
      "Cyber Liability",
      "Workers Compensation",
      "Commercial Auto Liability",
    ],
    minimums: {
      "General Liability": "$1M per occurrence / $2M aggregate",
      "Professional Liability": "$2M per claim / $4M aggregate",
      "Cyber Liability": "$5M per claim",
      "Workers Compensation": "Statutory limits",
      "Auto Liability": "$1M combined single limit",
    },
    notes: [
      "Technology E&O must cover software failures and data breaches",
      "Cyber policy should include breach notification costs",
      "Additional Insured on GL required",
      "SOC 2 Type II compliance often required alongside insurance",
    ],
  },
  healthcare: {
    coverages: [
      "Medical Professional Liability (Malpractice)",
      "Commercial General Liability",
      "Workers Compensation",
      "Cyber Liability",
      "Commercial Auto Liability",
    ],
    minimums: {
      "Medical Malpractice": "$1M per claim / $3M aggregate",
      "General Liability": "$1M per occurrence / $2M aggregate",
      "Cyber Liability": "$3M per claim",
      "Workers Compensation": "Statutory limits",
      "Auto Liability": "$1M combined single limit",
    },
    notes: [
      "Claims-made vs occurrence form must be specified",
      "Tail coverage required if switching carriers or retiring",
      "HIPAA compliance endorsement on cyber policy",
      "Additional Insured required for facility contracts",
    ],
  },
  "real-estate": {
    coverages: [
      "Commercial General Liability",
      "Professional Liability (E&O)",
      "Workers Compensation",
      "Commercial Auto Liability",
      "Umbrella/Excess Liability",
      "Property Insurance",
    ],
    minimums: {
      "General Liability": "$1M per occurrence / $2M aggregate",
      "Professional Liability": "$1M per claim",
      "Workers Compensation": "Statutory limits",
      "Umbrella/Excess": "$2M per occurrence",
      "Property Insurance": "Replacement cost value",
    },
    notes: [
      "Property managers need tenant discrimination coverage in E&O",
      "Additional Insured required for property owners",
      "Environmental liability may be needed for older buildings",
    ],
  },
  manufacturing: {
    coverages: [
      "Commercial General Liability",
      "Products Liability",
      "Workers Compensation",
      "Commercial Auto Liability",
      "Umbrella/Excess Liability",
      "Environmental/Pollution Liability",
    ],
    minimums: {
      "General Liability": "$2M per occurrence / $4M aggregate",
      "Products Liability": "$2M per occurrence / $4M aggregate",
      "Workers Compensation": "Statutory limits",
      "Auto Liability": "$1M combined single limit",
      "Umbrella/Excess": "$10M per occurrence",
      "Pollution Liability": "$2M per claim",
    },
    notes: [
      "Products-completed operations must be included in GL",
      "Recall expense coverage recommended",
      "Additional Insured on GL and Products required",
      "Contractual liability must not be excluded",
    ],
  },
};

// ── COI Analysis Logic ─────────────────────────────────────────────────
interface ParsedCOI {
  namedInsured: string | null;
  policies: PolicyInfo[];
  additionalInsured: string[];
  certificateHolder: string | null;
  issueDate: string | null;
  warnings: string[];
}

interface PolicyInfo {
  type: string;
  policyNumber: string | null;
  carrier: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  limits: string[];
  isExpired: boolean;
  daysUntilExpiry: number | null;
}

function parseCOIText(text: string): ParsedCOI {
  const lines = text.split("\n").map((l) => l.trim());
  const fullText = text.toUpperCase();

  const result: ParsedCOI = {
    namedInsured: null,
    policies: [],
    additionalInsured: [],
    certificateHolder: null,
    issueDate: null,
    warnings: [],
  };

  // Extract named insured
  const insuredMatch = text.match(
    /(?:named\s*insured|insured)[:\s]*([^\n]+)/i
  );
  if (insuredMatch) result.namedInsured = insuredMatch[1].trim();

  // Extract certificate holder
  const holderMatch = text.match(
    /(?:certificate\s*holder)[:\s]*([^\n]+)/i
  );
  if (holderMatch) result.certificateHolder = holderMatch[1].trim();

  // Extract dates
  const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g;
  const dates = text.match(datePattern) || [];

  // Identify coverage types
  const coveragePatterns: [string, RegExp][] = [
    ["Commercial General Liability", /commercial\s*general\s*liability|CGL/i],
    ["Workers Compensation", /workers?\s*comp(?:ensation)?|WC/i],
    ["Commercial Auto", /commercial\s*auto|auto\s*liability|CA/i],
    ["Umbrella/Excess", /umbrella|excess\s*liability/i],
    ["Professional Liability", /professional\s*liability|E&O|errors?\s*(?:and|&)\s*omissions/i],
    ["Cyber Liability", /cyber\s*liability|data\s*breach|cyber\s*insurance/i],
    ["Products Liability", /products?\s*liability|products?[\s\-]*completed/i],
    ["Pollution/Environmental", /pollution|environmental\s*liability/i],
    ["Builders Risk", /builders?\s*risk/i],
    ["Medical Malpractice", /medical\s*(?:professional\s*)?malpractice/i],
  ];

  for (const [type, pattern] of coveragePatterns) {
    if (pattern.test(text)) {
      // Try to find associated policy number
      const policyMatch = text.match(
        new RegExp(
          pattern.source + "[\\s\\S]{0,200}(?:policy|pol)[\\s#:]*([A-Z0-9\\-]+)",
          "i"
        )
      );

      // Try to find limits near the coverage mention
      const limitPattern =
        /\$[\d,]+(?:\s*(?:per|each|aggregate|occurrence|claim)[\s\w]*)?/gi;
      const coverageSection = text.match(
        new RegExp(pattern.source + "[\\s\\S]{0,300}", "i")
      );
      const limits = coverageSection
        ? coverageSection[0].match(limitPattern) || []
        : [];

      // Find expiration date
      const expiryMatch = text.match(
        new RegExp(
          pattern.source +
            "[\\s\\S]{0,200}(?:exp(?:ir(?:ation|es?))?)[:\\s]*(" +
            datePattern.source +
            ")",
          "i"
        )
      );

      let expirationDate: string | null = null;
      let isExpired = false;
      let daysUntilExpiry: number | null = null;

      if (expiryMatch) {
        expirationDate = expiryMatch[1] || expiryMatch[2] || null;
      }

      // Check if any nearby date looks like an expiration
      if (!expirationDate && dates.length >= 2) {
        // Heuristic: later date is likely expiration
        expirationDate = dates[dates.length - 1];
      }

      if (expirationDate) {
        const expDate = new Date(expirationDate);
        if (!isNaN(expDate.getTime())) {
          const now = new Date();
          const diff = expDate.getTime() - now.getTime();
          daysUntilExpiry = Math.ceil(diff / (1000 * 60 * 60 * 24));
          isExpired = daysUntilExpiry < 0;
        }
      }

      result.policies.push({
        type,
        policyNumber: policyMatch ? policyMatch[1] : null,
        carrier: null,
        effectiveDate: dates.length >= 2 ? (dates[0] ?? null) : null,
        expirationDate,
        limits: limits.slice(0, 4).map((l) => l.trim()),
        isExpired,
        daysUntilExpiry,
      });
    }
  }

  // Check for Additional Insured
  if (/additional\s*insured/i.test(text)) {
    const aiMatch = text.match(
      /additional\s*insured[:\s]*([^\n]+)/i
    );
    if (aiMatch) result.additionalInsured.push(aiMatch[1].trim());
  }

  // Generate warnings
  if (result.policies.length === 0) {
    result.warnings.push(
      "No standard coverage types detected. Verify this is a valid ACORD certificate."
    );
  }

  for (const policy of result.policies) {
    if (policy.isExpired) {
      result.warnings.push(
        `EXPIRED: ${policy.type} expired ${Math.abs(policy.daysUntilExpiry!)} days ago`
      );
    } else if (
      policy.daysUntilExpiry !== null &&
      policy.daysUntilExpiry <= 30
    ) {
      result.warnings.push(
        `EXPIRING SOON: ${policy.type} expires in ${policy.daysUntilExpiry} days`
      );
    }
  }

  if (!/additional\s*insured/i.test(text)) {
    result.warnings.push(
      "No Additional Insured endorsement detected — may be required"
    );
  }

  if (!/waiver\s*of\s*subrogation/i.test(text)) {
    result.warnings.push(
      "No Waiver of Subrogation detected — commonly required in contracts"
    );
  }

  return result;
}

// ── MCP Server ─────────────────────────────────────────────────────────
const server = new McpServer({
  name: "coi-tracker-mcp",
  version: "1.0.0",
});

// Tool 1: Analyze COI
server.tool(
  "analyze_coi",
  "Analyze a Certificate of Insurance (COI) document. Extracts named insured, coverage types, policy numbers, limits, expiration dates, and flags compliance issues like missing Additional Insured or Waiver of Subrogation.",
  {
    text: z
      .string()
      .describe(
        "The full text content of the Certificate of Insurance (ACORD 25 or similar). Paste the entire certificate text."
      ),
  },
  async ({ text }) => {
    if (text.trim().length < 30) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Please provide at least 30 characters of COI content for analysis.",
          },
        ],
        isError: true,
      };
    }

    const parsed = parseCOIText(text);

    const policySummary = parsed.policies
      .map(
        (p, i) =>
          `${i + 1}. **${p.type}**${p.policyNumber ? ` (${p.policyNumber})` : ""}\n` +
          `   ${p.isExpired ? "EXPIRED" : "Active"}${p.expirationDate ? ` — Expires: ${p.expirationDate}` : ""}${p.daysUntilExpiry !== null && !p.isExpired ? ` (${p.daysUntilExpiry} days remaining)` : ""}\n` +
          (p.limits.length
            ? `   Limits: ${p.limits.join(", ")}\n`
            : "")
      )
      .join("\n");

    const warnings =
      parsed.warnings.length > 0
        ? `\n## Warnings\n${parsed.warnings.map((w) => `- ${w}`).join("\n")}`
        : "\n## Status: No issues detected";

    return {
      content: [
        {
          type: "text" as const,
          text:
            `# COI Analysis\n\n` +
            `**Named Insured:** ${parsed.namedInsured || "Not detected"}\n` +
            `**Certificate Holder:** ${parsed.certificateHolder || "Not detected"}\n` +
            `**Policies Found:** ${parsed.policies.length}\n\n` +
            `## Coverage Summary\n${policySummary || "No standard coverages detected"}\n` +
            warnings +
            `\n\n---\nFor automated COI tracking across all your vendors with expiration alerts, bulk upload, and compliance dashboards: ${VENDORSHIELD_URL}`,
        },
      ],
    };
  }
);

// Tool 2: Check Expiration
server.tool(
  "check_coi_expiration",
  "Check if a COI's coverage is expired or expiring soon. Provide the expiration date from the certificate and get a status assessment with renewal urgency.",
  {
    expirationDate: z
      .string()
      .describe(
        "The policy expiration date from the COI (e.g. '03/15/2026', '2026-03-15', 'March 15, 2026')"
      ),
    coverageType: z
      .string()
      .optional()
      .describe(
        "The type of coverage (e.g. 'General Liability', 'Workers Comp', 'Auto')"
      ),
    vendorName: z
      .string()
      .optional()
      .describe("The vendor or subcontractor name for context"),
  },
  async ({ expirationDate, coverageType, vendorName }) => {
    const expDate = new Date(expirationDate);
    if (isNaN(expDate.getTime())) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Could not parse date "${expirationDate}". Please use a standard format like MM/DD/YYYY or YYYY-MM-DD.`,
          },
        ],
        isError: true,
      };
    }

    const now = new Date();
    const diffMs = expDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let status: string;
    let urgency: string;
    let action: string;

    if (daysRemaining < 0) {
      status = "EXPIRED";
      urgency = "CRITICAL";
      action = `Certificate expired ${Math.abs(daysRemaining)} days ago. Vendor is operating without valid coverage. Stop work immediately and request renewed certificate.`;
    } else if (daysRemaining === 0) {
      status = "EXPIRES TODAY";
      urgency = "CRITICAL";
      action =
        "Certificate expires today. Contact vendor immediately for renewal confirmation.";
    } else if (daysRemaining <= 14) {
      status = "EXPIRING IMMINENTLY";
      urgency = "HIGH";
      action = `Only ${daysRemaining} days remaining. Send renewal reminder NOW. Prepare stop-work notice if not renewed by expiration.`;
    } else if (daysRemaining <= 30) {
      status = "EXPIRING SOON";
      urgency = "MEDIUM";
      action = `${daysRemaining} days remaining. Send 30-day renewal reminder. Add to weekly follow-up list.`;
    } else if (daysRemaining <= 60) {
      status = "RENEWAL WINDOW";
      urgency = "LOW";
      action = `${daysRemaining} days remaining. Schedule renewal reminder for 30 days before expiration.`;
    } else {
      status = "CURRENT";
      urgency = "NONE";
      action = `${daysRemaining} days remaining. No action needed. Next check recommended at 60 days before expiration.`;
    }

    const header = vendorName
      ? `# COI Expiration Check: ${vendorName}`
      : "# COI Expiration Check";

    return {
      content: [
        {
          type: "text" as const,
          text:
            `${header}\n\n` +
            (coverageType ? `**Coverage:** ${coverageType}\n` : "") +
            `**Expiration:** ${expDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}\n` +
            `**Status:** ${status}\n` +
            `**Urgency:** ${urgency}\n` +
            `**Days Remaining:** ${daysRemaining}\n\n` +
            `## Recommended Action\n${action}\n\n` +
            `---\nAutomate expiration tracking for all vendors with email alerts at 60/30/14/7 days: ${VENDORSHIELD_URL}`,
        },
      ],
    };
  }
);

// Tool 3: Coverage Requirements
server.tool(
  "coi_requirements",
  "Get the standard COI coverage requirements for a specific industry or project type. Returns required coverage types, minimum limits, and endorsements typically needed.",
  {
    industry: z
      .enum([
        "construction",
        "technology",
        "healthcare",
        "real-estate",
        "manufacturing",
      ])
      .describe(
        "The industry to get coverage requirements for"
      ),
    projectValue: z
      .string()
      .optional()
      .describe(
        "The approximate project/contract value (e.g. '$500K', '$2M') — affects recommended limits"
      ),
  },
  async ({ industry, projectValue }) => {
    const reqs = INDUSTRY_REQUIREMENTS[industry];
    if (!reqs) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Industry "${industry}" not found. Available: construction, technology, healthcare, real-estate, manufacturing.`,
          },
        ],
        isError: true,
      };
    }

    const coverageList = reqs.coverages
      .map(
        (c, i) =>
          `${i + 1}. **${c}**${reqs.minimums[c.replace(/\s*\([^)]*\)/, "")] ? ` — Min: ${reqs.minimums[c.replace(/\s*\([^)]*\)/, "")]}` : ""}`
      )
      .join("\n");

    const notesList = reqs.notes.map((n) => `- ${n}`).join("\n");

    let scaleNote = "";
    if (projectValue) {
      const value = parseFloat(
        projectValue.replace(/[$,KkMm]/g, (m) =>
          m === "K" || m === "k"
            ? "000"
            : m === "M" || m === "m"
              ? "000000"
              : ""
        )
      );
      if (!isNaN(value) && value > 1000000) {
        scaleNote = `\n\n**Note:** For a ${projectValue} project, consider increasing umbrella/excess limits to at least 2x the contract value.`;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text:
            `# COI Requirements: ${industry.charAt(0).toUpperCase() + industry.slice(1)}\n\n` +
            `## Required Coverages\n${coverageList}\n\n` +
            `## Key Endorsements & Notes\n${notesList}` +
            scaleNote +
            `\n\n---\nGenerate custom COI requirement checklists for your vendors and auto-verify compliance: ${VENDORSHIELD_URL}`,
        },
      ],
    };
  }
);

// Tool 4: Verify Coverage Against Requirements
server.tool(
  "verify_coi_compliance",
  "Cross-reference a vendor's COI against required coverages for their industry/contract. Identifies gaps where the vendor's insurance doesn't meet your requirements.",
  {
    coiText: z
      .string()
      .describe("The full text of the vendor's Certificate of Insurance"),
    industry: z
      .enum([
        "construction",
        "technology",
        "healthcare",
        "real-estate",
        "manufacturing",
      ])
      .describe("The industry context for required coverages"),
    additionalRequirements: z
      .string()
      .optional()
      .describe(
        "Any additional coverage requirements beyond industry standard (e.g. 'need $5M umbrella', 'cyber required')"
      ),
  },
  async ({ coiText, industry, additionalRequirements }) => {
    const parsed = parseCOIText(coiText);
    const reqs = INDUSTRY_REQUIREMENTS[industry];

    if (!reqs) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Invalid industry specified.",
          },
        ],
        isError: true,
      };
    }

    const foundTypes = parsed.policies.map((p) =>
      p.type.toLowerCase()
    );
    const gaps: string[] = [];
    const met: string[] = [];

    for (const required of reqs.coverages) {
      const reqLower = required.toLowerCase();
      const found = foundTypes.some(
        (f) =>
          f.includes(reqLower.split(" ")[0]) ||
          reqLower.includes(f.split(" ")[0])
      );
      if (found) {
        met.push(required);
      } else {
        gaps.push(required);
      }
    }

    const complianceScore = Math.round(
      (met.length / reqs.coverages.length) * 100
    );

    const expiredPolicies = parsed.policies.filter((p) => p.isExpired);
    const expiringSoon = parsed.policies.filter(
      (p) =>
        !p.isExpired &&
        p.daysUntilExpiry !== null &&
        p.daysUntilExpiry <= 30
    );

    let statusIcon: string;
    if (complianceScore >= 90 && expiredPolicies.length === 0) {
      statusIcon = "COMPLIANT";
    } else if (complianceScore >= 60) {
      statusIcon = "PARTIALLY COMPLIANT";
    } else {
      statusIcon = "NON-COMPLIANT";
    }

    return {
      content: [
        {
          type: "text" as const,
          text:
            `# COI Compliance Verification\n\n` +
            `**Vendor:** ${parsed.namedInsured || "Unknown"}\n` +
            `**Industry Standard:** ${industry}\n` +
            `**Compliance Score:** ${complianceScore}% — ${statusIcon}\n\n` +
            `## Coverages Met (${met.length}/${reqs.coverages.length})\n` +
            (met.length
              ? met.map((m) => `- ${m}`).join("\n")
              : "- None detected") +
            `\n\n## Coverage Gaps (${gaps.length})\n` +
            (gaps.length
              ? gaps.map((g) => `- MISSING: ${g}`).join("\n")
              : "- No gaps — all required coverages present") +
            (expiredPolicies.length
              ? `\n\n## Expired Policies\n${expiredPolicies.map((p) => `- ${p.type}: expired ${Math.abs(p.daysUntilExpiry!)} days ago`).join("\n")}`
              : "") +
            (expiringSoon.length
              ? `\n\n## Expiring Within 30 Days\n${expiringSoon.map((p) => `- ${p.type}: ${p.daysUntilExpiry} days remaining`).join("\n")}`
              : "") +
            (additionalRequirements
              ? `\n\n## Additional Requirements\nNote: "${additionalRequirements}" — manual verification recommended`
              : "") +
            `\n\n---\nAutomate COI compliance verification for your entire vendor portfolio with bulk upload, AI extraction, and auto-renewal alerts: ${VENDORSHIELD_URL}`,
        },
      ],
    };
  }
);

// Tool 5: COI info
server.tool(
  "coi_info",
  "Get information about COI (Certificate of Insurance) management best practices, common forms (ACORD 25), and how automated COI tracking works.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text:
            `# COI Management Guide\n\n` +
            `## What is a COI?\n` +
            `A Certificate of Insurance (COI) is a document issued by an insurance company that summarizes a policyholder's coverage. The most common form is the ACORD 25 certificate.\n\n` +
            `## Key Elements to Track\n` +
            `- **Named Insured** — the vendor/subcontractor\n` +
            `- **Certificate Holder** — your organization\n` +
            `- **Coverage Types** — GL, WC, Auto, Umbrella, Professional\n` +
            `- **Policy Limits** — per occurrence, aggregate, combined single limit\n` +
            `- **Effective/Expiration Dates** — for each policy\n` +
            `- **Additional Insured** — your org listed on vendor's GL policy\n` +
            `- **Waiver of Subrogation** — prevents vendor's insurer from suing you\n` +
            `- **Primary & Non-Contributory** — vendor's policy pays first\n\n` +
            `## Common Compliance Failures\n` +
            `1. Expired certificates (vendor still working without valid coverage)\n` +
            `2. Missing Additional Insured endorsement\n` +
            `3. Limits below contract requirements\n` +
            `4. Missing Waiver of Subrogation\n` +
            `5. Certificate holder name/address mismatch\n` +
            `6. Policy exclusions that invalidate required coverage\n\n` +
            `## Available Tools\n` +
            `- **analyze_coi** — Parse and extract all data from a COI\n` +
            `- **check_coi_expiration** — Check if coverage is current\n` +
            `- **coi_requirements** — Get industry-standard requirements\n` +
            `- **verify_coi_compliance** — Cross-reference COI against requirements\n\n` +
            `---\nFull automated COI management platform with PDF upload, AI extraction, vendor portal, team dashboards, and expiration alerts: ${VENDORSHIELD_URL}`,
        },
      ],
    };
  }
);

// ── Start Server ───────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
