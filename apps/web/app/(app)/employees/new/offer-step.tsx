"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DraftSettings } from "../../../../lib/employees/draft";

interface StepResult {
  step: string;
  status: "ok" | "skipped" | "failed" | "action";
  detail: string;
  url?: string;
}

export interface OfferStepProps {
  employeeId: string;
  draft: DraftSettings;
  managerName: string;
  onBack: () => void;
  onEdit: () => void;
  onHired: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PP";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function OfferStep({
  employeeId,
  draft,
  managerName,
  onBack,
  onEdit,
  onHired,
}: OfferStepProps) {
  const router = useRouter();
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [showTechDetails, setShowTechDetails] = useState(false);

  const firstName = draft.name ? draft.name.trim().split(/\s+/)[0] : "Employee";
  const initials = getInitials(draft.name || "Pepper Potts");

  const emailStep = steps.find((s) => s.step === "email");
  const slackStep = steps.find((s) => s.step === "slack");

  const emailFailed = emailStep?.status === "failed";
  const hasFailed = steps.some((s) => s.status === "failed");

  const isEmailLimit =
    emailFailed &&
    (emailStep?.detail?.includes("limit") ||
      emailStep?.detail?.includes("plan limit reached") ||
      emailStep?.detail?.includes("active inboxes limit") ||
      emailStep?.detail?.includes("inbox limit"));

  // Done counter: Soul file + Voice assistant are ready by default.
  let doneCount = 2;
  if (emailStep?.status === "ok") doneCount++;
  if (slackStep?.status === "ok") doneCount++;

  async function handleHire(force = false) {
    setGeneralError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/hire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await res.json().catch(() => ({}));
      setPending(false);
      if (!res.ok) {
        setGeneralError(body.error ?? "Hire failed");
        return;
      }
      if (body.status === "active") {
        onHired();
        return;
      }
      setSteps(body.steps ?? []);
      router.refresh();
    } catch (err) {
      setPending(false);
      setGeneralError(err instanceof Error ? err.message : "Hire failed");
    }
  }

  function handleConnectSlack() {
    if (slackStep?.url) {
      window.open(slackStep.url, "_blank");
    } else {
      router.push("/account");
    }
  }

  const showAlert = emailFailed || (steps.length > 0 && hasFailed);
  const alertTitle = `${firstName} is partly set up. Email needs attention.`;
  const alertBody = isEmailLimit || emailFailed
    ? `Her voice assistant is ready. The email inbox couldn't be created because your plan has reached its inbox limit. Nothing you entered was lost.`
    : `Her voice assistant is ready. The email inbox couldn't be created: ${emailStep?.detail || generalError}. Nothing you entered was lost.`;

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#fff", margin: "0 0 8px 0" }}>
          Offer for {draft.name || "Employee"}
        </h1>
        <p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>
          Review the details, then hire to set up email, Slack, and voice.
        </p>
      </div>

      <div className="offer-grid">
        {/* Left Column */}
        <div className="offer-left-col">
          {/* Attention banner if provisioning failed or email inbox limit reached */}
          {showAlert ? (
            <div className="offer-alert-card" role="alert">
              <div className="offer-alert-icon" aria-hidden="true">
                !
              </div>
              <div className="offer-alert-text">
                <h3 className="offer-alert-title">{alertTitle}</h3>
                <p className="offer-alert-body">{alertBody}</p>
              </div>
            </div>
          ) : null}

          {/* Setting up [Name] card */}
          <div className="offer-card">
            <div className="offer-card-header">
              <h3 className="offer-card-title">Setting up {firstName}</h3>
              <span className="offer-card-subtitle">{doneCount} of 4 done</span>
            </div>

            <div className="setting-up-list">
              {/* Soul file */}
              <div className="setting-up-item">
                <span className="setting-up-icon done" aria-hidden="true">
                  ✓
                </span>
                <div className="setting-up-content">
                  <div className="setting-up-row-top">
                    <span className="setting-up-name">Soul file</span>
                    <span className="offer-badge done">Done</span>
                  </div>
                  <p className="setting-up-desc">
                    Role, limits, and escalation rules written from the job description.
                  </p>
                </div>
              </div>

              {/* Voice assistant */}
              <div className="setting-up-item">
                <span className="setting-up-icon done" aria-hidden="true">
                  ✓
                </span>
                <div className="setting-up-content">
                  <div className="setting-up-row-top">
                    <span className="setting-up-name">Voice assistant</span>
                    <span className="offer-badge ready">Ready</span>
                  </div>
                  <p className="setting-up-desc">
                    {firstName} can take web calls now.
                  </p>
                </div>
              </div>

              {/* Email inbox */}
              <div className="setting-up-item">
                <span
                  className={`setting-up-icon ${emailFailed ? "warning" : emailStep?.status === "ok" ? "done" : "muted"}`}
                  aria-hidden="true"
                >
                  {emailFailed ? "!" : emailStep?.status === "ok" ? "✓" : "–"}
                </span>
                <div className="setting-up-content">
                  <div className="setting-up-row-top">
                    <span className="setting-up-name">Email inbox</span>
                    {emailFailed ? (
                      <span className="offer-badge warning">
                        <span style={{ fontSize: 9 }}>●</span> Couldn&apos;t create
                      </span>
                    ) : emailStep?.status === "ok" ? (
                      <span className="offer-badge ready">Ready</span>
                    ) : (
                      <span className="offer-badge muted">Ready to create</span>
                    )}
                  </div>
                  <p className="setting-up-desc">
                    {emailFailed
                      ? isEmailLimit
                        ? "Your plan's inbox limit has been reached. Free up an inbox or upgrade, then try again."
                        : emailStep?.detail || "Could not provision email inbox."
                      : emailStep?.status === "ok"
                        ? emailStep.detail
                        : "AgentMail inbox will be assigned upon hire."}
                  </p>

                  {emailFailed ? (
                    <>
                      <div className="setting-up-actions">
                        <button
                          type="button"
                          className="btn-primary-blue"
                          disabled={pending}
                          onClick={() => handleHire(false)}
                        >
                          {pending ? "Retrying…" : "Try again"}
                        </button>
                        <Link href="/account" className="btn-secondary">
                          Upgrade plan
                        </Link>
                        <button
                          type="button"
                          className="btn-ghost-details"
                          onClick={() => setShowTechDetails((v) => !v)}
                        >
                          Technical details
                        </button>
                      </div>
                      {showTechDetails ? (
                        <pre className="technical-details-box">
                          {emailStep?.detail || "AgentMail API limit reached"}
                        </pre>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>

              {/* Slack handle */}
              <div className="setting-up-item">
                <span
                  className={`setting-up-icon ${slackStep?.status === "ok" ? "done" : "muted"}`}
                  aria-hidden="true"
                >
                  {slackStep?.status === "ok" ? "✓" : "–"}
                </span>
                <div className="setting-up-content">
                  <div className="setting-up-row-top">
                    <span className="setting-up-name">Slack handle</span>
                    <span className={`offer-badge ${slackStep?.status === "ok" ? "ready" : "muted"}`}>
                      {slackStep?.status === "ok" ? "Ready" : "Not connected"}
                    </span>
                  </div>
                  <p className="setting-up-desc">
                    Optional. Connect Slack so {firstName} can reach {managerName} and teammates.
                  </p>
                  {slackStep?.status !== "ok" ? (
                    <div className="setting-up-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleConnectSlack}
                      >
                        Connect Slack
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Role and rules card */}
          <div className="offer-card role-rules-card">
            <div className="offer-card-header">
              <h3 className="offer-card-title">Role and rules</h3>
              <button type="button" className="offer-edit-btn" onClick={onEdit}>
                Edit
              </button>
            </div>
            <div className="role-rules-table">
              <div className="role-rules-row">
                <span className="role-rules-label">Role</span>
                <span className="role-rules-val">{draft.role || "Personal Assistant to the CEO"}</span>
              </div>
              <div className="role-rules-row">
                <span className="role-rules-label">Reports to</span>
                <span className="role-rules-val">{managerName}</span>
              </div>
              <div className="role-rules-row">
                <span className="role-rules-label">Starting autonomy</span>
                <span className="autonomy-pill">Shadow: drafts only, you approve</span>
              </div>
              <div className="role-rules-row">
                <span className="role-rules-label">Escalates to</span>
                <span className="role-rules-val">{managerName}, by email and Slack</span>
              </div>
            </div>
          </div>

          {generalError ? (
            <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>
              {generalError}
            </p>
          ) : null}

          {/* Bottom Actions Bar */}
          <div className="offer-bottom-bar">
            <button
              type="button"
              className="btn-secondary"
              onClick={onBack}
              disabled={pending}
            >
              Back
            </button>

            <div className="offer-bottom-right">
              {hasFailed ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={pending}
                    onClick={() => handleHire(true)}
                  >
                    {pending ? "Finishing…" : "Finish without email"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary-blue"
                    disabled={pending}
                    onClick={() => handleHire(false)}
                  >
                    {pending ? "Retrying…" : "Try email setup again"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-primary-blue"
                  disabled={pending}
                  onClick={() => handleHire(false)}
                >
                  {pending ? "Provisioning…" : `Hire ${firstName}`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column Summary Card */}
        <aside className="offer-summary-card" aria-label="New employee summary">
          <div className="offer-summary-profile">
            <div className="offer-summary-avatar">{initials}</div>
            <div className="offer-summary-info">
              <h3 className="offer-summary-name">{draft.name || "New hire"}</h3>
              <p className="offer-summary-role">
                {draft.role || "Personal Assistant to the CEO"}
              </p>
            </div>
          </div>

          <div className="offer-summary-rows">
            <div className="offer-summary-row">
              <span className="offer-summary-label">Reports to</span>
              <span className="offer-summary-val">{managerName}</span>
            </div>
            <div className="offer-summary-row">
              <span className="offer-summary-label">Email</span>
              {emailFailed ? (
                <span className="offer-badge warning">Needs attention</span>
              ) : emailStep?.status === "ok" ? (
                <span className="offer-badge ready">Ready</span>
              ) : (
                <span className="offer-badge muted">Pending</span>
              )}
            </div>
            <div className="offer-summary-row">
              <span className="offer-summary-label">Voice</span>
              <span className="offer-badge ready">Ready</span>
            </div>
            <div className="offer-summary-row">
              <span className="offer-summary-label">Slack</span>
              {slackStep?.status === "ok" ? (
                <span className="offer-badge ready">Ready</span>
              ) : (
                <span className="offer-badge muted">Not connected</span>
              )}
            </div>
            <div className="offer-summary-row">
              <span className="offer-summary-label">Apps</span>
              <span className="offer-summary-val muted-text">None yet, add later</span>
            </div>
          </div>

          <p className="offer-summary-footnote">
            You can change anything here after hiring, and pause {firstName} at any time.
          </p>
        </aside>
      </div>
    </div>
  );
}
