import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import { readImmutableEvidenceBundle } from "../application/EvidenceBundleFiles.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { toolContract } from "../contracts/toolContracts.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { auditEvidenceCoverage } from "../domain/evidenceCoverageAudit.js";
import { compareEvidenceBundles } from "../domain/evidenceBundleComparison.js";
import { explainEvidenceChain } from "../domain/evidenceChain.js";
import {
  diagnoseEnvironmentInputSchema,
  projectEnvironmentDiagnosis,
} from "../domain/environmentDiagnosis.js";
import { createInvestigationReport } from "../domain/investigationReport.js";
import { err, ok } from "../domain/result.js";
import { renderSessionChart } from "../domain/sessionChart.js";
import { projectUnknownImpact } from "../domain/unknownImpact.js";
import { investigationEvidenceBundle } from "../application/investigation/InvestigationEvidence.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

interface InvestigationAuditToolOptions {
  readonly artifactResources: ArtifactResourceScope;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
}

/**
 * Register read-only projections over the retained session. None of these
 * tools queries a provider, records Evidence, or mutates session state; the
 * environment diagnosis delegates to the same read-only doctor workflow the
 * CLI uses.
 */
export const registerInvestigationAuditTools = (
  server: EvidenceMcpServer,
  session: BinarySessionPort,
  options: InvestigationAuditToolOptions,
): void => {
  const chainContract = toolContract("explain_evidence_chain");
  server.registerTool(
    chainContract.name,
    toolRegistrationOptions(chainContract),
    (input) =>
      server.delivery.toCallToolResult(
        explainEvidenceChain(input, investigationEvidenceBundle(session)),
        chainContract,
      ),
  );

  const compareContract = toolContract("compare_evidence_bundles");
  server.registerTool(
    compareContract.name,
    toolRegistrationOptions(compareContract),
    async (input, context) => {
      const reference = await readImmutableEvidenceBundle(
        input.path,
        context.mcpReq.signal,
        options.artifactResources,
        compareContract.name,
      );
      if (!reference.ok)
        return server.delivery.toCallToolResult(reference, compareContract);
      return server.delivery.toCallToolResult(
        ok(
          compareEvidenceBundles(
            investigationEvidenceBundle(session),
            reference.value,
            input,
          ),
        ),
        compareContract,
      );
    },
  );

  const auditContract = toolContract("audit_evidence_coverage");
  server.registerTool(
    auditContract.name,
    toolRegistrationOptions(auditContract),
    (input) =>
      server.delivery.toCallToolResult(
        ok(auditEvidenceCoverage(investigationEvidenceBundle(session), input)),
        auditContract,
      ),
  );

  const diagnosisContract = toolContract("diagnose_environment");
  server.registerTool(
    diagnosisContract.name,
    toolRegistrationOptions(diagnosisContract),
    async (input, context) => {
      const parsed = diagnoseEnvironmentInputSchema.parse(input);
      // Load provider diagnostics only when this tool is called so the MCP
      // server does not pull every provider adapter into its startup path.
      const { runDoctorOwned } = await import("../application/Doctor.js");
      const { createSystemDoctorHost } = await import("../doctorRuntime.js");
      try {
        const report = await runDoctorOwned(
          undefined,
          createSystemDoctorHost(options.environment, context.mcpReq.signal),
          parsed.providers.length === 0
            ? undefined
            : {
                clients: [],
                skill: false,
                providers: parsed.providers,
              },
        );
        return server.delivery.toCallToolResult(
          ok(projectEnvironmentDiagnosis(report)),
          diagnosisContract,
        );
      } catch (cause: unknown) {
        if (cause instanceof AnalysisError)
          return server.delivery.toCallToolResult(
            err(cause),
            diagnosisContract,
          );
        throw cause;
      }
    },
  );

  const impactContract = toolContract("project_unknown_impact");
  server.registerTool(
    impactContract.name,
    toolRegistrationOptions(impactContract),
    (input) =>
      server.delivery.toCallToolResult(
        ok(projectUnknownImpact(investigationEvidenceBundle(session), input)),
        impactContract,
      ),
  );

  const chartContract = toolContract("render_session_chart");
  server.registerTool(
    chartContract.name,
    toolRegistrationOptions(chartContract),
    (input) =>
      server.delivery.toCallToolResult(
        renderSessionChart(investigationEvidenceBundle(session), input),
        chartContract,
      ),
  );

  const reportContract = toolContract("export_investigation_report");
  server.registerTool(
    reportContract.name,
    toolRegistrationOptions(reportContract),
    (input) =>
      server.delivery.toCallToolResult(
        ok(
          createInvestigationReport(
            investigationEvidenceBundle(session),
            input,
          ),
        ),
        reportContract,
      ),
  );
};
