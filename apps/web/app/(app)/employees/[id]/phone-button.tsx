"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ate/design/components/Button";

/**
 * Buy this employee a phone number, from the Channels list (#252). Hire does
 * not do this: a number costs money every month and most employees need none,
 * so it is a per-employee decision made here rather than a step every hire
 * runs. `POST /api/employees/[id]/phone` does the work and is idempotent, so a
 * double click returns the same number instead of buying a second one.
 *
 * A new number is not callable for a minute or two, and Vapi says nothing when
 * that ends — so while it activates this shows "Activating…" rather than a
 * number that declines, and polls until it is real.
 */
const POLL_MS = 5000;

function formatPhone(num: string): string {
  const cleaned = num.replace(/\D/g, "");
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  return num;
}

export function PhoneButton({
  employeeId,
  number,
  status,
}: {
  employeeId: string;
  number: string | null;
  status: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(Boolean(number) && status !== "active");

  useEffect(() => {
    if (!activating) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/employees/${employeeId}/phone`);
      if (!res.ok) return;
      const body = (await res.json()) as { status?: string };
      if (body.status === "active") {
        setActivating(false);
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activating, employeeId, router]);

  async function provision() {
    setError(null);
    setPending(true);
    const res = await fetch(`/api/employees/${employeeId}/phone`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setPending(false);
    if (!res.ok) {
      setError(body.error ?? "Could not get a number. Try again");
      return;
    }
    if (body.status === "active") router.refresh();
    else setActivating(true);
  }

  if (activating) {
    return <span style={{ opacity: 0.7 }}>Activating… (a minute or two)</span>;
  }
  if (number) {
    return (
      <a href={`tel:${number}`} style={{ color: "var(--fg)" }}>
        {formatPhone(number)}
      </a>
    );
  }

  return (
    <>
      <Button variant="ghost" disabled={pending} onClick={provision}>
        {pending ? "Getting a number…" : "Get a number"}
      </Button>
      {error ? (
        <p role="alert" style={{ margin: "8px 0 0", color: "var(--red, #e5484d)", fontSize: 13 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
