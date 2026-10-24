import { z } from "zod";

import { diagnoseEnvironmentInputSchema } from "../domain/environmentDiagnosis.js";
import { evidenceChainInputSchema } from "../domain/evidenceChain.js";
import { compareEvidenceBundlesInputSchema } from "../domain/evidenceBundleComparison.js";
import { auditEvidenceCoverageInputSchema } from "../domain/evidenceCoverageAudit.js";
import { investigationReportInputSchema } from "../domain/investigationReport.js";
import { sessionChartInputSchema } from "../domain/sessionChart.js";
import { unknownImpactInputSchema } from "../domain/unknownImpact.js";
import { examplesFor } from "./toolContractHelpers.js";
import { toolContractMetadata } from "./toolEffects.js";
import type { ToolContract } from "./toolContractTypes.js";
import { sessionOutputSchemas } from "./toolOutputSchemaGroups.js";
import { requireOutputSchema } from "./toolOutputSchemaPrimitives.js";

const session = <
  Name extends keyof typeof sessionOutputSchemas,
  Schema extends z.ZodObject,
>(
  name: Name,
  description: string,
  inputSchema: Schema,
) =>
  ({
    name,
    ...toolContractMetadata(name),
    description,
    kind: "session",
    inputSchema,
    outputSchema: requireOutputSchema(sessionOutputSchemas, name),
    examples: examplesFor(name, inputSchema),
  }) satisfies ToolContract<Name, Schema>;

/** Read-only audit and presentation tools over a retained session. */
export const INVESTIGATION_AUDIT_TOOL_CONTRACTS = [
  session(
    "explain_evidence_chain",
    "Explain the retained provenance of one Evidence record by following its evidence_links to the observations it rests on and, when requested, the observations that cite it. Returns the bounded node set, edges, linked identifiers that are not retained, and explicit truncation. It records no Evidence and does not rank importance; a missing identifier describes the bundle, not the target.",
    evidenceChainInputSchema,
  ),
  session(
    "compare_evidence_bundles",
    "Compare this session's retained Evidence with an exported bundle file. Records are paired only when operation, provider, subject, parameters, and analysis-profile commitment match; paired records are reported as identical or changed, and unmatched records are reported separately without claiming absence. The comparison records no Evidence and does not merge the bundle.",
    compareEvidenceBundlesInputSchema,
  ),
  session(
    "audit_evidence_coverage",
    "Audit retained coverage across observed operations. Reports per-operation record counts and confidence classes, relationship-coverage states, unresolved and contradicted Unknowns, and the gaps that remain with the observation that could close each one. It queries no provider, records no Evidence, and does not claim that an unobserved operation is absent from the target.",
    auditEvidenceCoverageInputSchema,
  ),
  session(
    "diagnose_environment",
    "Diagnose the local analysis environment with the same read-only checks as the CLI doctor command. Reports each check's status, classification, detail, and remediation without exposing secrets or changing the host. It observes the host, not the target, and records no Evidence.",
    diagnoseEnvironmentInputSchema,
  ),
  session(
    "project_unknown_impact",
    "Project unresolved Unknowns onto the retained Evidence that supports or contradicts them, including cited procedures, subjects, and source locations. Reports identifiers that are no longer retained and Unknowns with no observed dependency. It traverses no call edge, records no Evidence, and makes no runtime-impact claim.",
    unknownImpactInputSchema,
  ),
  session(
    "render_session_chart",
    "Chart one aggregate of the retained session: records per operation, Unknowns per status, records per confidence class, or records per relationship-coverage state. Returns the chart plus the exact values and contributing Evidence identifiers. The chart is presentation only and records no Evidence.",
    sessionChartInputSchema,
  ),
  session(
    "export_investigation_report",
    "Render a deterministic Markdown investigation report from retained Evidence: target identity, per-operation inventory, coverage gaps, unresolved Unknowns, citations, and an optional chart. The report is a projection, records no Evidence, and states its omissions.",
    investigationReportInputSchema,
  ),
] as const satisfies readonly ToolContract[];
