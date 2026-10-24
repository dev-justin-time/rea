import type { EvidenceBundle } from "../../domain/evidenceBundle.js";
import {
  searchEvidenceBundle,
  type EvidenceSearchResult,
  type SearchEvidenceInput,
} from "../../domain/evidenceSearch.js";

/** Search already-retained Evidence without starting or querying a provider. */
export const searchInvestigationEvidence = (
  bundle: EvidenceBundle,
  input: SearchEvidenceInput,
): EvidenceSearchResult => searchEvidenceBundle(bundle, input);
