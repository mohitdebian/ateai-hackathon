"use client";

import { useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import type { CreateAssistantDTO } from "@vapi-ai/web/dist/api";
import { Button } from "@ate/design/components/Button";
import { Card } from "@ate/design/components/Card";
import { initials } from "../../../../lib/avatar";

// Statically referenced so Next inlines it into the client bundle (see lib/env.ts).
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;

type CallState = "idle" | "connecting" | "in-call";

/**
 * A browser voice call via Vapi — either with a provisioned assistant (id
 * string, the employee profile's "Talk to me") or an inline, transient
 * assistant (a CreateAssistantDTO, the pre-hire interview panel: nothing is
 * provisioned or persisted, no voice connector, no dashboard entry).
 * The end-of-call report for a provisioned assistant flows back through
 * /api/webhooks/vapi, so that call shows up in the activity rail and the
 * employee's memory like any other turn; an inline assistant has no webhook,
 * so its caller is responsible for anything it wants recorded (onCallEnd).
 */
export interface TranscriptTurn {
  role: string;
  text: string;
}

export function TalkPanel({
  employeeId,
  assistantId,
  assistant,
  title = "Talk to me",
  description = "Start a live voice call.",
  onCallEnd,
  onActiveChange,
  layout,
  className,
  style,
}: {
  /** Provisioned employee (profile "Talk to me"): the call is created server-side (#43). */
  employeeId?: string;
  assistantId?: string | null;
  /** Pre-hire interview: an inline, transient assistant — nothing is persisted or
   *  provisioned, so #43's spoofing concern doesn't apply and the call can start
   *  directly from the client. */
  assistant?: CreateAssistantDTO | null;
  title?: string;
  description?: string;
  /** Full transcript at hangup, oldest first. Vapi's own conversation-update
   *  message already carries the running history, so no manual accumulation. */
  onCallEnd?: (transcript: TranscriptTurn[]) => void;
  /** Fires whenever a call becomes active/inactive, so a caller can block an
   *  action until the call — and its onCallEnd — ends. */
  onActiveChange?: (active: boolean) => void;
  /** "interview" is the hiring flow's candidate card, "profile" the
   *  employee page's compact call row. Omitted is the plain panel. */
  layout?: "interview" | "profile";
  className?: string;
  style?: React.CSSProperties;
}) {
  const vapiRef = useRef<Vapi | null>(null);
  const assistantRef = useRef(assistant);
  assistantRef.current = assistant;
  const onCallEndRef = useRef(onCallEnd);
  onCallEndRef.current = onCallEnd;
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const [state, setState] = useState<CallState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!PUBLIC_KEY) return;
    const vapi = new Vapi(PUBLIC_KEY);
    vapi.on("call-start", () => {
      transcriptRef.current = [];
      setElapsedSeconds(0);
      setState("in-call");
    });
    vapi.on("message", (message: unknown) => {
      const m = message as {
        type?: string;
        conversation?: { role: string; content: unknown }[];
      };
      // The transcript rides on `conversation`, not the SDK-documented
      // `messagesOpenAIFormatted`, which comes back empty on this account/version.
      if (m?.type !== "conversation-update" || !Array.isArray(m.conversation))
        return;
      transcriptRef.current = m.conversation
        .filter((msg) => msg.role === "user" || msg.role === "assistant")
        .map((msg) => ({
          role: msg.role,
          text: String(msg.content ?? "").trim(),
        }))
        .filter((turn) => turn.text);
    });
    vapi.on("call-end", () => {
      setState("idle");
      onCallEndRef.current?.(transcriptRef.current);
    });
    vapi.on("error", (e: unknown) => {
      setError(e instanceof Error ? e.message : "Call failed");
      setState("idle");
    });
    vapiRef.current = vapi;
    return () => {
      vapi.stop();
      vapiRef.current = null;
    };
  }, []);

  useEffect(() => {
    onActiveChangeRef.current?.(state !== "idle");
  }, [state]);

  useEffect(() => {
    if (state !== "in-call") return;
    const interval = window.setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [state]);

  if (layout !== "interview" && !assistant && !assistantId) return null;

  async function start() {
    setError(null);
    setState("connecting");
    if (assistantRef.current) {
      // Inline, transient assistant (pre-hire interview) — nothing is persisted
      // server-side, so the client can start it directly.
      try {
        await vapiRef.current?.start(assistantRef.current);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Call failed");
        setState("idle");
      }
      return;
    }
    try {
      // The server decides who's calling and creates the call itself (#43) —
      // this just joins it. The browser never gets to set caller_name/
      // caller_relation, so it can't claim to be the manager.
      const res = await fetch(`/api/employees/${employeeId}/call`, {
        method: "POST",
      });
      if (!res.ok) {
        // Say what actually went wrong — a bare "Could not start call" hides a
        // missing vendor key behind the same words as a real failure (#96).
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not start call");
      }
      // Structurally the SDK's WebCall (not exported from @vapi-ai/web): the
      // optional fields decide video/voice handling, so pass them through.
      const call = (await res.json()) as {
        webCallUrl: string;
        id?: string;
        artifactPlan?: { videoRecordingEnabled?: boolean };
        assistant?: { voice?: { provider?: string } };
      };
      await vapiRef.current?.reconnect(call);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Call failed");
      setState("idle");
    }
  }

  if (layout === "interview") {
    const isActive = state === "in-call";
    return (
      <Card
        className={`${className ?? ""} candidate-interview-card${isActive ? " active" : ""}`.trim()}
        style={style}
      >
        <div className="candidate-interview-person">
          <div className="candidate-interview-avatar">
            {initials(title)}
          </div>
          <strong>{title}</strong>
          <p>
            {isActive
              ? formatCallDuration(elapsedSeconds)
              : description}
          </p>
        </div>
        {!PUBLIC_KEY ? (
          <p className="candidate-interview-error">
            Voice calling is not configured.
          </p>
        ) : isActive ? (
          <Button
            type="button"
            variant="ghost"
            className="candidate-interview-end"
            onClick={() => vapiRef.current?.stop()}
          >
            <img src="/figma/interview-end-call.svg" alt="" />
            End interview
          </Button>
        ) : (
          <Button
            type="button"
            variant="blue"
            className="candidate-interview-start"
            disabled={state === "connecting" || !assistant}
            onClick={start}
          >
            {state === "connecting" ? "Connecting…" : "Start voice interview"}
          </Button>
        )}
        {error ? (
          <p role="alert" className="candidate-interview-error">
            {error}
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className={className} style={{ marginTop: 24, ...style }}>
      <div className="talk-panel-copy">
        {layout === "profile" ? <img src="/icons/calling.svg" alt="" /> : null}
        <div>
          <p style={{ margin: "0 0 4px" }}>
            <strong>{title}</strong>
          </p>
          <p style={{ margin: "0 0 16px", opacity: 0.75, fontSize: 14 }}>
            {description}
          </p>
        </div>
      </div>
      {!PUBLIC_KEY ? (
        <p style={{ margin: 0, opacity: 0.6, fontSize: 14 }}>
          NEXT_PUBLIC_VAPI_PUBLIC_KEY is not configured. See
          apps/web/.env.example.
        </p>
      ) : state === "in-call" ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => vapiRef.current?.stop()}
        >
          ● End call
        </Button>
      ) : (
        <Button
          type="button"
          variant="blue"
          disabled={state === "connecting"}
          onClick={start}
        >
          {state === "connecting" ? "Connecting…" : "Start call"}
        </Button>
      )}
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
    </Card>
  );
}

function formatCallDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes} : ${remainder}`;
}
