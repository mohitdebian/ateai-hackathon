/** Settings the hiring wizard collects across its two draft calls. */
export interface DraftSettings {
  name: string;
  role: string;
  persona: string;
  scope_of_work: string;
  daily_responsibilities: string[];
  operating_rules: string[];
}

/** Structured output for the first call: JD to interviewable candidate. */
export const draftProfileSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "A concise human name for the AI employee." },
    role: { type: "string", description: "A job title, e.g. Support Rep or Billing Analyst." },
    persona: { type: "string", description: "Who they are and how they work, in 1–2 sentences." },
  },
  required: ["name", "role", "persona"],
} as const;

/** Structured output for the second call: interview and training to onboarding. */
export const onboardingSettingsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scope_of_work: { type: "string", description: "What the employee owns, in 1–2 sentences." },
    daily_responsibilities: {
      type: "array",
      items: { type: "string" },
      description: "Concrete recurring work only; exclude constraints, prohibitions, approvals, security, and escalation rules.",
    },
    operating_rules: {
      type: "array",
      items: { type: "string" },
      description: "Hard boundaries the employee must follow, including prohibitions, approvals, security, and escalations; exclude routine work.",
    },
  },
  required: ["scope_of_work", "daily_responsibilities", "operating_rules"],
} as const;

// Claude occasionally bleeds its tool-invocation XML into forced tool-call
// strings. Strip untrusted model syntax at the API boundary.
const TOOL_XML_ARTIFACT = /<\/?(?:parameter|invoke|function_calls?)(?:\s[^>]*)?>/gi;

function cleanString(s: unknown): string {
  const str = String(s ?? "").replace(TOOL_XML_ARTIFACT, "").trim();
  const upper = str.toUpperCase();
  return upper === "<UNKNOWN>" || upper === "UNKNOWN" ? "" : str;
}

// The model sometimes sends a list as JSON text rather than an array, or as an
// array wrapping that text (#261). Anything that isn't a clean list of strings
// stays untouched so it falls through to the newline split below.
function unwrapJsonList(v: unknown): string[] | null {
  const text = Array.isArray(v) && v.length === 1 ? v[0] : v;
  if (typeof text !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function cleanList(v: unknown): string[] {
  const list =
    unwrapJsonList(v) ?? (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []);
  return list.map(cleanString).filter(Boolean);
}

/** Normalize a raw tool result into the wizard's complete state shape. */
export function sanitizeDraft(settings: Partial<DraftSettings>): DraftSettings {
  return {
    name: cleanString(settings.name),
    role: cleanString(settings.role),
    persona: cleanString(settings.persona),
    scope_of_work: cleanString(settings.scope_of_work),
    daily_responsibilities: cleanList(settings.daily_responsibilities),
    operating_rules: cleanList(settings.operating_rules),
  };
}

export const emptyDraft: DraftSettings = {
  name: "",
  role: "",
  persona: "",
  scope_of_work: "",
  daily_responsibilities: [],
  operating_rules: [],
};
