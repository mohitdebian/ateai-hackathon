"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ate/design/components/Button";

interface Step {
  step: string;
  status: "ok" | "skipped" | "failed" | "action";
  detail: string;
  url?: string;
}

/**
 * The new-hire run's final action (docs/product.md "Vision"). Runs the
 * provisioning sequence and shows what each step did. Idempotent server-side,
 * so the same button is the retry when a step failed. Lives only in the wizard:
 * the profile page is display-only, and an employee that reaches it is hired
 * (#96).
 */
export function HirePanel({
  employeeId,
  onHired,
  label,
}: {
  employeeId: string;
  /** Fired only once the employee actually reaches `active`. */
  onHired?: () => void;
  label?: string;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function hire() {
    setError(null);
    setPending(true);
    const res = await fetch(`/api/employees/${employeeId}/hire`, {
      method: "POST",
    });
    setPending(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Hire failed");
      return;
    }
    // The route answers 200 even when a step failed, reporting it as
    // `status: "incomplete"` in the body — so only an `active` employee counts
    // as hired. A pending Slack install is an `action`, not a failure: the
    // employee is hired, and the profile offers that install link from the
    // stored nonce, so hand off there without ever showing the step list.
    // Anything less stays disposable (#38) and stays here, where the steps
    // explain what broke and this button is the retry (#96).
    if (body.status === "active") {
      onHired?.();
      return;
    }
    setSteps(body.steps ?? []);
    router.refresh();
  }

  const buttonLabel = steps.some((s) => s.status === "failed")
    ? "Retry provisioning"
    : (label ?? "Hire");
  const icon = { ok: "✓", skipped: "–", failed: "✕", action: "→" } as const;

  // A single element, not a fragment: callers place this inside a flex row,
  // where a fragment's children would each become their own column.
  return (
    <div className="hire-panel">
      <Button variant="blue" disabled={pending} onClick={hire}>
        {pending ? "Provisioning…" : buttonLabel}
      </Button>
      {error ? (
        <p role="alert" className="hire-error">
          {error}
        </p>
      ) : null}
      {steps.length > 0 ? (
        <ul className="hire-steps">
          {steps.map((s) => (
            <li key={s.step} className={s.status === "failed" ? "failed" : ""}>
              {icon[s.status]} {s.step}:{" "}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener">
                  {provisioningDetail(s.detail)}
                </a>
              ) : (
                provisioningDetail(s.detail)
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function provisioningDetail(detail: string) {
  const jsonStart = detail.indexOf("{");
  if (jsonStart < 0) return detail;

  try {
    const parsed = JSON.parse(detail.slice(jsonStart)) as { message?: unknown };
    const message = typeof parsed.message === "string" ? parsed.message : null;
    const prefix = detail.slice(0, jsonStart).trim().replace(/:\s*$/, "");
    return message ? `${prefix}: ${message}` : detail;
  } catch {
    return detail;
  }
}
