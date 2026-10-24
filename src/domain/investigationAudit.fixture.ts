import { createAnalysisProfile } from "./analysisProfile.js";
import {
  createEvidence,
  type Evidence,
  type EvidenceObservation,
} from "./evidence.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { createEvidenceBundle } from "./evidenceBundle.js";
import {
  createResidualUnknown,
  type ResidualUnknown,
} from "./residualUnknown.js";

export const AUDIT_PROVIDER = {
  id: "fixture",
  name: "Fixture provider",
  version: "1.0.0",
} as const;

export const fixtureEvidence = (
  observation: Partial<EvidenceObservation> & { operation: string },
  sha256 = "1".repeat(64),
): Evidence =>
  createEvidence(
    { path: "/tmp/fixture.bin", sha256, format: "mach-o" },
    AUDIT_PROVIDER,
    {
      predicateType: `fixture.${observation.operation}`,
      parameters: {},
      result: { observed: true },
      analysisProfile: createAnalysisProfile(AUDIT_PROVIDER, {}),
      confidence: "observed",
      authority: "shipped-artifact",
      ...observation,
    },
  );

export const fixtureUnknown = (
  mutationEvidenceId: string,
  supportingEvidenceIds: readonly string[],
  options: { question?: string; probes?: number } = {},
): ResidualUnknown =>
  createResidualUnknown(
    {
      question: options.question ?? "Was the observed call fully covered?",
      severity: "medium",
      domain: "fixture",
      required_authority: "shipped-artifact",
      required_confidence: "observed",
      required_environment: null,
      recommended_probes:
        options.probes === 0
          ? []
          : [
              {
                operation: "analyze_function",
                rationale: "Collect complete callee coverage.",
              },
            ],
      relationships: [],
      supporting_evidence_ids: [...supportingEvidenceIds],
      contradicting_evidence_ids: [],
    },
    mutationEvidenceId,
    null,
  );

export const fixtureBundle = (
  records: readonly Evidence[],
  unknowns: readonly ResidualUnknown[] = [],
): EvidenceBundle => createEvidenceBundle(records, unknowns);
