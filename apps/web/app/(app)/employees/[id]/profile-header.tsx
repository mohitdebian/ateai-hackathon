"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Vapi from "@vapi-ai/web";
import { Button } from "@ate/design/components/Button";
import { Avatar } from "../../../../lib/avatar";
import { SoulModal } from "./soul-modal";

import type { IdentityFile } from "@ate/shared";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;

export function ProfileHeader({
  employee,
  identity,
  managerName,
  lastActionTime,
}: {
  employee: { id: string; name: string; hired_at: string | null };
  identity?: Partial<IdentityFile> | null;
  managerName: string | null;
  assistantId?: string | null;
  lastActionTime?: string | null;
}) {
  const router = useRouter();
  const firstName = employee.name.split(" ")[0];
  const [isSoulOpen, setIsSoulOpen] = useState(false);
  const [callState, setCallState] = useState<"idle" | "connecting" | "in-call">("idle");
  const [callElapsed, setCallElapsed] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(Boolean(identity?.paused));
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const vapiRef = useRef<Vapi | null>(null);

  useEffect(() => {
    setIsPaused(Boolean(identity?.paused));
  }, [identity?.paused]);

  useEffect(() => {
    if (!PUBLIC_KEY) return;
    const vapi = new Vapi(PUBLIC_KEY);
    vapi.on("call-start", () => {
      setCallElapsed(0);
      setCallState("in-call");
    });
    vapi.on("call-end", () => {
      setCallState("idle");
    });
    vapi.on("error", (e: unknown) => {
      setCallError(e instanceof Error ? e.message : "Call failed");
      setCallState("idle");
    });
    vapiRef.current = vapi;
    return () => {
      vapi.stop();
      vapiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (callState !== "in-call") return;
    const interval = window.setInterval(
      () => setCallElapsed((s) => s + 1),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [callState]);

  async function handleVoiceCall() {
    if (callState === "in-call") {
      vapiRef.current?.stop();
      setCallState("idle");
      return;
    }

    if (isPaused) {
      setCallError(`${firstName} is paused. Resume employee to make voice calls.`);
      return;
    }

    if (!PUBLIC_KEY) {
      setCallError("Voice calling requires NEXT_PUBLIC_VAPI_PUBLIC_KEY in Vercel. Please set it in Vercel Project Settings → Environment Variables and trigger a redeploy.");
      return;
    }

    setCallError(null);
    setCallState("connecting");
    try {
      const res = await fetch(`/api/employees/${employee.id}/call`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not start call");
      }
      const call = await res.json();
      await vapiRef.current?.reconnect(call);
      router.refresh();
    } catch (e) {
      setCallError(e instanceof Error ? e.message : "Call failed");
      setCallState("idle");
    }
  }

  async function handlePauseToggle() {
    if (isTogglingPause) return;
    const nextPaused = !isPaused;
    setIsTogglingPause(true);
    setCallError(null);
    try {
      const res = await fetch(`/api/employees/${employee.id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: nextPaused }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update pause state");
      }
      setIsPaused(nextPaused);
      window.dispatchEvent(
        new CustomEvent("employee-paused-change", {
          detail: { employeeId: employee.id, paused: nextPaused },
        }),
      );
      router.refresh();
    } catch (e) {
      setCallError(e instanceof Error ? e.message : "Failed to toggle pause");
    } finally {
      setIsTogglingPause(false);
    }
  }

  // Format last action time relative
  const lastActionText = (() => {
    if (!lastActionTime) return "Active recently";
    const diffMin = Math.round(
      (Date.now() - new Date(lastActionTime).getTime()) / 60000,
    );
    if (diffMin <= 1) return "Last action just now";
    if (diffMin < 60) return `Last action ${diffMin} min ago`;
    const diffHours = Math.round(diffMin / 60);
    return `Last action ${diffHours}h ago`;
  })();

  return (
    <>
      <nav className="profile-breadcrumbs">
        <Link href="/dashboard" className="profile-breadcrumb-link">
          Workforce
        </Link>
        <span className="profile-breadcrumb-sep">/</span>
        <span className="profile-breadcrumb-current">{employee.name}</span>
      </nav>

      <section className="profile-hero-card">
        <div className="profile-hero-left">
          <Avatar name={employee.name} className="person-avatar profile-hero-avatar" />
          <div className="profile-hero-info">
            <h1 className="profile-hero-name">{employee.name}</h1>
            <p className="profile-hero-subtitle">
              {identity?.role || "Staff Accountant"}. Reports to {managerName ?? "texter"}.
            </p>
            <div className="profile-hero-badges">
              {isPaused ? (
                <span className="profile-badge-paused">
                  <span className="profile-badge-dot-paused" />
                  Paused
                </span>
              ) : (
                <span className="profile-badge-online">
                  <span className="profile-badge-dot" />
                  Online
                </span>
              )}
              <span className="profile-badge-action">{lastActionText}</span>
            </div>
          </div>
        </div>

        <div className="profile-hero-actions">
          <Button
            variant={callState === "in-call" ? "dark" : "blue"}
            onClick={handleVoiceCall}
            disabled={callState === "connecting" || (isPaused && callState !== "in-call")}
            title={isPaused && callState !== "in-call" ? `${firstName} is paused` : undefined}
            className={`profile-hero-voice-btn ${callState === "in-call" ? "active" : ""}`}
          >
            {callState === "connecting"
              ? "Connecting…"
              : callState === "in-call"
                ? `End call (${Math.floor(callElapsed / 60)}:${String(callElapsed % 60).padStart(2, "0")})`
                : "Start voice call"}
          </Button>

          <Button
            variant="ghost"
            onClick={() => setIsSoulOpen(true)}
            className="profile-hero-soul-btn"
          >
            Open soul file
          </Button>

          <Button
            variant="ghost"
            onClick={handlePauseToggle}
            disabled={isTogglingPause}
            className={`profile-hero-pause-btn ${isPaused ? "paused" : ""}`}
          >
            {isTogglingPause
              ? "Updating…"
              : isPaused
                ? `Resume ${firstName}`
                : `Pause ${firstName}`}
          </Button>
        </div>
      </section>

      {callError && (
        <div className="profile-hero-call-error">
          <span>{callError}</span>
          <button type="button" onClick={() => setCallError(null)}>✕</button>
        </div>
      )}

      <SoulModal
        isOpen={isSoulOpen}
        onClose={() => setIsSoulOpen(false)}
        employeeName={employee.name}
        identity={identity}
      />
    </>
  );
}
