import { z } from "zod";

/** Caller-selected provider boundary for the environment audit. */
export const diagnoseEnvironmentInputSchema = z.strictObject({
  providers: z
    .array(z.string().min(1))
    .max(16)
    .default([])
    .describe(
      "Provider identifiers to diagnose; an empty list audits every configured provider",
    ),
});

export type DiagnoseEnvironmentInput = z.output<
  typeof diagnoseEnvironmentInputSchema
>;

const checkSchema = z.strictObject({
  name: z.string().min(1),
  status: z.enum(["available", "missing", "unsupported", "unknown"]),
  classification: z.string().min(1),
  detail: z.string().nullable(),
  remediation: z.string().nullable(),
});

/** Read-only environment findings, with remediation but no install action. */
export const environmentDiagnosisResultSchema = z.strictObject({
  healthy: z.boolean(),
  environment_healthy: z.boolean(),
  checks: z.array(checkSchema),
  providers: z.array(
    z.strictObject({
      id: z.string().min(1),
      configured: z.boolean(),
      available: z.boolean(),
      provider_version: z.string().nullable(),
      checks: z.array(
        z.strictObject({
          name: z.string().min(1),
          status: z.enum(["available", "missing", "unsupported", "unknown"]),
          classification: z.string().min(1),
          code: z.string().nullable(),
          detail: z.string().nullable(),
          remediation: z.string().nullable(),
        }),
      ),
    }),
  ),
  summary: z.strictObject({
    available: z.int().min(0),
    missing: z.int().min(0),
    unknown: z.int().min(0),
  }),
  limitations: z.array(z.string()),
});

export type EnvironmentDiagnosisResult = z.output<
  typeof environmentDiagnosisResultSchema
>;

interface DoctorCheckObservation {
  readonly name: string;
  readonly ok: boolean;
  readonly classification: string;
  readonly detail?: string | undefined;
  readonly remediation?: string | undefined;
}

/** Structural subset of the doctor report this projection consumes. */
export interface EnvironmentDiagnosisReport {
  readonly healthy: boolean;
  readonly environment_healthy: boolean;
  readonly checks: readonly DoctorCheckObservation[];
  readonly providerInspections?:
    | readonly {
        readonly id: string;
        readonly configured: boolean;
        readonly available: boolean;
        readonly providerVersion: string | null;
        readonly checks: readonly {
          readonly name: string;
          readonly ok: boolean;
          readonly classification: string;
          readonly code: string | null;
          readonly detail: string;
          readonly remediation: string | null;
        }[];
      }[]
    | undefined;
}

const statusOf = (check: {
  readonly ok: boolean;
  readonly classification: string;
}): "available" | "missing" | "unsupported" | "unknown" => {
  if (check.ok) return "available";
  if (check.classification === "unknown") return "unknown";
  if (
    check.classification === "unsupported_host" ||
    check.classification === "unsupported_target"
  )
    return "unsupported";
  return "missing";
};

/**
 * Project a doctor report without re-running or weakening its checks. Doctor
 * owns provider probing, remediation text, and secret-safe details; this adds
 * only the stable status vocabulary an agent can branch on.
 */
export const projectEnvironmentDiagnosis = (
  report: EnvironmentDiagnosisReport,
): EnvironmentDiagnosisResult => {
  const checks = report.checks.map((check) => ({
    name: check.name,
    status: statusOf(check),
    classification: check.classification,
    detail: check.detail ?? null,
    remediation: check.remediation ?? null,
  }));
  const providers = (report.providerInspections ?? []).map((provider) => ({
    id: provider.id,
    configured: provider.configured,
    available: provider.available,
    provider_version: provider.providerVersion,
    checks: provider.checks.map((check) => ({
      name: check.name,
      status: statusOf(check),
      classification: check.classification,
      code: check.code,
      detail: check.detail ?? null,
      remediation: check.remediation ?? null,
    })),
  }));
  const summary = { available: 0, missing: 0, unknown: 0 };
  for (const check of checks) {
    if (check.status === "available") summary.available += 1;
    else if (check.status === "unknown") summary.unknown += 1;
    else summary.missing += 1;
  }
  return environmentDiagnosisResultSchema.parse({
    healthy: report.healthy,
    environment_healthy: report.environment_healthy,
    checks,
    providers,
    summary,
    limitations: [
      "Diagnosis observes this host and its configuration; it does not execute the target or record Evidence about the target.",
      "Checks that could not be completed are reported as unknown rather than missing.",
      "The result names remediation only; it never installs, updates, or repairs a dependency.",
    ],
  });
};
