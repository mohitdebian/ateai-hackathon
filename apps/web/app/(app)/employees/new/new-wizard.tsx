"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@ate/design/components/Button";
import {
  Eyebrow,
  DisplayHeading,
  Lede,
} from "@ate/design/components/Typography";
import {
  emptyDraft,
  type DraftSettings,
} from "../../../../lib/employees/draft";
import { buildAssistantDTO } from "../../../../lib/channels/vapi-assistant";
import { TalkPanel, type TranscriptTurn } from "../[id]/talk-panel";
import { AccessPanel } from "../[id]/access-panel";
import { OfferStep } from "./offer-step";

type Step = "describe" | "configure" | "access" | "offer";

/** Heading per step — the run is one continuous set of screens, so the copy moves with it (#38). */
const COPY: Record<Step, { heading: string; lede: string }> = {
  describe: {
    heading: "Describe the job",
    lede: "Write a job description. ate.ai drafts the configuration from it.",
  },
  configure: {
    heading: "Review the details",
    lede: "Edit anything here. This is what the employee will be.",
  },
  access: {
    heading: "Access",
    lede: "Set up how people reach this employee, then what it can use to get work done.",
  },
  offer: {
    heading: "Offer",
    lede: "Review the new employee, then hire to provision email, Slack, and voice.",
  },
};

const STEPS: { id: Step; label: string }[] = [
  { id: "describe", label: "Job description" },
  { id: "configure", label: "Identity" },
  { id: "access", label: "Access" },
  { id: "offer", label: "Offer" },
];

export function NewEmployeeWizard({ managerName }: { managerName: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("describe");
  const [jd, setJd] = useState("");
  const [draft, setDraft] = useState<DraftSettings>(emptyDraft);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [hired, setHired] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interview, setInterview] = useState<TranscriptTurn[]>([]);
  const [interviewActive, setInterviewActive] = useState(false);

  // The row exists from the configure step onward, so abandoning the run midway
  // would strand a `provisioning` employee on the dashboard forever — the very
  // thing dropping `draft` was meant to prevent (#38). Warn on the way out, and
  // discard the half-built employee. `keepalive` (not sendBeacon) because this
  // has to be a DELETE, and same-origin fetch carries the session cookie.
  const atRisk = employeeId !== null && !hired;

  useEffect(() => {
    if (!atRisk) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const discard = () => {
      fetch(`/api/employees/${employeeId}`, {
        method: "DELETE",
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", discard);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", discard);
    };
  }, [atRisk, employeeId]);

  // In-app exit: `beforeunload` never fires on a client-side route change, so the
  // cancel path has to ask and clean up itself.
  const cancel = useCallback(async () => {
    if (!employeeId) {
      router.push("/dashboard");
      return;
    }
    if (
      !window.confirm(
        "Leave now and this employee won't be hired. Your progress will be lost.",
      )
    )
      return;
    await fetch(`/api/employees/${employeeId}`, { method: "DELETE" }).catch(
      () => {},
    );
    router.push("/dashboard");
    router.refresh();
  }, [employeeId, router]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await fetch("/api/employees/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "create",
        job_description: jd,
        manager_name: managerName,
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not draft settings");
      return;
    }
    const { settings } = (await res.json()) as {
      settings: Partial<DraftSettings>;
    };
    setDraft({
      ...emptyDraft,
      name: String(settings.name ?? ""),
      role: String(settings.role ?? ""),
      persona: String(settings.persona ?? ""),
    });
    setStep("configure");
  }

  // Creates the employee row — from here on the run is continuous: grant
  // access, and hire all operate on this same id (#38).
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const finalDraft = { ...draft };
    try {
      const draftRes = await fetch("/api/employees/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "finalize",
          job_description: jd,
          current_draft: draft,
          manager_name: managerName,
          transcript: interview,
        }),
      });
      if (draftRes.ok) {
        const { settings } = await draftRes.json();
        finalDraft.scope_of_work = settings.scope_of_work;
        finalDraft.daily_responsibilities = settings.daily_responsibilities;
        finalDraft.operating_rules = settings.operating_rules;
      }
    } catch (err) {
      console.error("Failed to finalize background details", err);
      setError("Could not draft responsibilities — the employee will be created without them. You can add them later via chat.");
    }

    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...finalDraft,
        ...(interview.length ? { interview } : {}),
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save employee");
      return;
    }
    const { id } = (await res.json()) as { id: string };
    setEmployeeId(id);
    setStep("access");
  }

  const header = (
    <div className="wizard-heading">
      <Eyebrow>New hire</Eyebrow>
      <DisplayHeading size="lg">{COPY[step].heading}</DisplayHeading>
      <Lede>{COPY[step].lede}</Lede>
    </div>
  );

  if (step === "describe") {
    return (
      <WizardLayout
        step={step}
        draft={draft}
        managerName={managerName}
        onExit={cancel}
      >
        {header}
        <div className="wizard-card">
          <form onSubmit={generate} style={{ display: "grid", gap: 16 }}>
            <p style={{ margin: 0, opacity: 0.6, fontSize: 14 }}>
              Reports to: {managerName}
            </p>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="eyebrow">Job description</span>
              <textarea
                required
                rows={10}
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                placeholder="e.g. A frontline customer support rep who answers billing questions over email and Slack, escalates refunds, and keeps a daily summary…"
                style={areaStyle}
              />
            </label>
            {error ? <p style={errStyle}>{error}</p> : null}
            <div style={{ display: "flex", gap: 12 }}>
              <Button type="submit" variant="blue" disabled={pending}>
                {pending ? "Starting…" : "Start hiring"}
              </Button>
            </div>
          </form>
        </div>
      </WizardLayout>
    );
  }

  if (step === "configure") {
    return (
      <WizardLayout
        step={step}
        draft={draft}
        managerName={managerName}
        onExit={cancel}
      >
        {header}
        <form className="identity-form" onSubmit={create}>
          <div className="identity-review">
            <div className="identity-fields">
              <Field
                label="Name"
                value={draft.name}
                onChange={(v) => setDraft({ ...draft, name: v })}
              />
              <Field
                label="Role"
                value={draft.role}
                onChange={(v) => setDraft({ ...draft, role: v })}
              />

              {error ? <p style={errStyle}>{error}</p> : null}
            </div>
            <InterviewPanel
              draft={draft}
              jobDescription={jd}
              onTranscript={setInterview}
              onActiveChange={setInterviewActive}
            />
          </div>
          <div className="wizard-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep("describe")}
              disabled={pending || interviewActive}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="blue"
              disabled={pending || interviewActive}
            >
              {pending
                ? "Creating…"
                : interviewActive
                  ? "End the call to continue"
                  : "Continue"}
            </Button>
          </div>
        </form>
      </WizardLayout>
    );
  }

  // Every step past "configure" operates on the created employee. This should
  // be unreachable; say so rather than rendering a blank page if it is not.
  if (!employeeId) {
    return (
      <WizardLayout
        step={step}
        draft={draft}
        managerName={managerName}
        onExit={cancel}
      >
        {header}
        <div className="wizard-card">
          <p className="muted">
            This run lost track of the employee it was creating. Go back to the
            dashboard and start again.
          </p>
        </div>
      </WizardLayout>
    );
  }

  if (step === "access") {
    return (
      <WizardLayout
        step={step}
        draft={draft}
        managerName={managerName}
        onExit={cancel}
      >
        {header}
        <AccessPanel employeeId={employeeId} />
        <div className="wizard-actions">
          <Button variant="ghost" onClick={() => setStep("configure")}>
            Back
          </Button>
          <Button variant="blue" onClick={() => setStep("offer")}>
            Continue
          </Button>
        </div>
      </WizardLayout>
    );
  }

  // Hiring is the last thing the run does: once it succeeds, the employee is
  // real and the run hands off to its profile (#96). A failed step keeps the
  // employee in `provisioning` and stays here, where the same button is the
  // retry (#38). Hire may also return an `action` step — the Slack install link
  // — which HirePanel renders inline and the profile offers again afterwards.
  return (
    <WizardLayout
      step={step}
      draft={draft}
      managerName={managerName}
      onExit={cancel}
    >
      <OfferStep
        employeeId={employeeId}
        draft={draft}
        managerName={managerName}
        onBack={() => setStep("access")}
        onEdit={() => setStep("configure")}
        onHired={() => setHired(true)}
      />
      {hired ? (
        <div
          className="hire-success"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hire-success-title"
        >
          <div className="hire-success-card">
            <div className="hire-success-icon" aria-hidden="true">
              ✓
            </div>
            <h2 id="hire-success-title">{draft.name} is part of the team</h2>
            <p>Email, Slack, voice, and app access are being readied now.</p>
            <div className="hire-success-actions">
              <Link
                href={`/employees/${employeeId}`}
                className="btn btn-ghost"
                autoFocus
              >
                View profile
              </Link>
              <Link href="/dashboard" className="btn btn-blue">
                Go to dashboard
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </WizardLayout>
  );
}

function WizardLayout({
  step,
  onExit,
  children,
}: {
  step: Step;
  draft?: DraftSettings;
  managerName?: string;
  onExit: () => void;
  children: React.ReactNode;
}) {
  const activeIndex = STEPS.findIndex((item) => item.id === step);

  return (
    <div className="wizard-container-v2">
      <nav className="wizard-breadcrumb" aria-label="Breadcrumb">
        <button type="button" onClick={onExit}>
          Workforce
        </button>
        <span aria-hidden="true">/</span>
        <span>New employee</span>
      </nav>

      <div className="wizard-stepper-horizontal" aria-label="Progress">
        {STEPS.map((item, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          return (
            <div key={item.id} className="stepper-step-container">
              <div
                className={`stepper-item ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}
              >
                <span
                  className={`stepper-circle ${isDone ? "done" : ""} ${isActive ? "active" : ""} ${!isDone && !isActive ? "pending" : ""}`}
                >
                  {isDone ? "✓" : index + 1}
                </span>
                <span>{item.label}</span>
              </div>
              {index < STEPS.length - 1 && <div className="stepper-divider" />}
            </div>
          );
        })}
      </div>

      <section className="wizard-content">{children}</section>
    </div>
  );
}

/**
 * Voice interview with the drafted employee, before hiring (docs/product.md
 * "Vision" — "Talk to me area"). Uses a transient inline Vapi assistant built
 * from the live, unsaved draft: no provisioning, nothing written to the
 * database, no voice connector, no cleanup needed afterward.
 */
function InterviewPanel({
  draft,
  jobDescription,
  onTranscript,
  onActiveChange,
}: {
  draft: DraftSettings;
  jobDescription: string;
  onTranscript: (transcript: TranscriptTurn[]) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const ready = Boolean(draft.name && draft.persona);
  const assistant = ready ? buildAssistantDTO(draft, { jobDescription }) : null;

  function handleCallEnd(transcript: TranscriptTurn[]) {
    if (transcript.length < 2) return;
    onTranscript(transcript);
  }

  return (
    <TalkPanel
      assistant={assistant}
      title={draft.name || "New hire"}
      description={
        ready
          ? "Ready to talk through the role with you."
          : "Fill in name and persona to enable the interview."
      }
      onCallEnd={handleCallEnd}
      onActiveChange={onActiveChange}
      layout="interview"
    />
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span className="eyebrow">{label}</span>
      {textarea ? (
        <textarea
          ref={autosize}
          rows={1}
          value={value}
          onChange={(e) => {
            autosize(e.target);
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          style={areaStyle}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
    </label>
  );
}

/** Grow a textarea to fit its content, so a pre-filled AI draft starts at full height. */
function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}



const inputStyle: React.CSSProperties = {
  background: "var(--fill-2)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  color: "var(--fg)",
  padding: 12,
  fontFamily: "var(--f-disp)",
  fontSize: 14,
  fontWeight: 500,
  lineHeight: "20px",
};

const areaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "none",
};

const errStyle: React.CSSProperties = {
  margin: 0,
  color: "var(--red)",
  fontSize: 14,
};
