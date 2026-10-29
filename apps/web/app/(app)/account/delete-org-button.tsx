"use client";

import { useState } from "react";
import { Button } from "@ate/design/components/Button";

export function DeleteOrgButton({ orgName }: { orgName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteOrg() {
    setError(null);
    setPending(true);
    const res = await fetch("/api/org", {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPending(false);
      setError(body.error ?? "Failed to delete organization. Try again");
      return;
    }
    // Organization and session deleted, navigate to login
    window.location.href = "/login";
  }

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Delete organization
      </Button>
    );
  }

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 14, opacity: 0.85 }}>
        This permanently deletes <strong>{orgName}</strong>, all employees, data, and associated email inboxes. Are you sure?
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <Button variant="dark" disabled={pending} onClick={deleteOrg}>
          {pending ? "Deleting organization…" : "Yes, delete organization"}
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
