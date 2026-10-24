export type GuiApprovalDecision = "approve" | "reject";

/** A decision held until the operator answers; undecided calls never run. */
export class GuiApprovals {
  readonly #pending = new Map<
    string,
    (decision: GuiApprovalDecision) => void
  >();
  readonly #early = new Map<string, GuiApprovalDecision>();

  /** Wait for the operator, the caller's abort, or the approval timeout. */
  register(id: string, signal?: AbortSignal): Promise<GuiApprovalDecision> {
    const early = this.#early.get(id);
    if (early !== undefined) {
      this.#early.delete(id);
      return Promise.resolve(early);
    }
    if (signal?.aborted === true) return Promise.resolve("reject");
    return new Promise<GuiApprovalDecision>((resolve) => {
      const settle = (decision: GuiApprovalDecision): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#pending.delete(id);
        resolve(decision);
      };
      const onAbort = (): void => settle("reject");
      const timer = setTimeout(() => settle("reject"), 10 * 60 * 1000);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(id, settle);
    });
  }

  /** Record the operator's answer, even when it arrives before the wait. */
  decide(id: string, decision: GuiApprovalDecision): void {
    const pending = this.#pending.get(id);
    if (pending !== undefined) pending(decision);
    else this.#early.set(id, decision);
  }

  /** Reject every outstanding request; a closed turn must not wait forever. */
  rejectAll(): void {
    for (const settle of [...this.#pending.values()]) settle("reject");
    this.#early.clear();
  }
}
