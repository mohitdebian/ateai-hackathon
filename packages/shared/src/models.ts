/**
 * The two Claude models the platform uses: Sonnet by default, Opus for
 * harder tasks. Centralized so the
 * web create-step and the worker turn never drift on model IDs.
 */
export const MODELS = {
  /** Default brain for employee turns and the create step. */
  sonnet: "claude-sonnet-5",
  /** Escalation model for harder tasks / subagents. */
  opus: "claude-opus-4-8",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];
