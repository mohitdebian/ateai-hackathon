"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ate/design/components/Button";

/**
 * Fire (or, for a draft, discard) an employee from the profile page (#108).
 * DELETE /api/employees/[id] does the real work — vendor teardown first, row
 * last (#102) — so this is only a trigger with an inline two-step confirm:
 * the first click swaps the button for a confirm/cancel pair rather than
 * opening a dialog (the design package has no modal, and it's read-only).
 * Teardown makes several vendor calls, so the confirm shows a busy state; a
 * failed AgentMail delete comes back 503 with the row intact, so the error
 * leaves the confirm in place as the retry.
 */
export function FireButton({
  employeeId,
  hired,
}: {
  employeeId: string;
  hired: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verb = hired ? "Fire" : "Discard";

  async function fire() {
    setError(null);
    setPending(true);
    const res = await fetch(`/api/employees/${employeeId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPending(false);
      setError(body.error ?? `${verb} failed. Try again`);
      return;
    }
    // Leave `pending` on through the navigation so the button can't fire twice.
    router.push("/dashboard");
    router.refresh();
  }

  if (!confirming) {
    return (
      <div style={{ marginTop: 24 }}>
        <Button variant="ghost" onClick={() => setConfirming(true)}>
          {verb} employee
        </Button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ margin: "0 0 12px", fontSize: 14, opacity: 0.85 }}>
        {hired
          ? "This permanently removes the employee and its email inbox, Slack app, and voice assistant. Are you sure?"
          : "This permanently discards the draft. Are you sure?"}
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <Button variant="dark" disabled={pending} onClick={fire}>
          {pending
            ? `${verb === "Fire" ? "Firing" : "Discarding"}…`
            : `Yes, ${verb.toLowerCase()}`}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          style={{
            margin: "12px 0 0",
            color: "var(--red, #e5484d)",
            fontSize: 14,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
