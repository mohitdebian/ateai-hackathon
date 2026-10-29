"use client";

import { useEffect, useMemo, useState } from "react";
import type { EventRow } from "@ate/shared";
import { Card } from "@ate/design/components/Card";
import { formatToolEvent } from "../../../../lib/format-event";
import { createClient } from "../../../../lib/supabase/client";

const HISTORY_LIMIT = 30;

type HistoryEvent = Pick<
  EventRow,
  "id" | "channel" | "kind" | "payload" | "created_at"
>;

function mergeHistory(
  next: HistoryEvent[],
  current: HistoryEvent[],
): HistoryEvent[] {
  const unique = new Map<string, HistoryEvent>();
  for (const event of [...next, ...current]) unique.set(event.id, event);
  return [...unique.values()]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, HISTORY_LIMIT);
}

function renderBold(text: string) {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function getEventBadge(event: HistoryEvent) {
  const payload = event.payload as {
    direction?: string;
    kind?: string;
    text?: string;
    tool?: string;
    actual_channel?: string;
  };

  // Tool executions must ALWAYS be tagged with the Tools badge
  if (event.kind === "tool") {
    return { label: "Tools", dotColor: "#8b949e", badgeClass: "activity-badge-gray" };
  }

  // Resolve true channel (handles DB fallback where actual_channel is in payload)
  const channel = (payload?.actual_channel || event.channel || "").toLowerCase();
  const dir = (payload?.direction || "").toLowerCase();

  if (channel === "web") {
    if (dir === "inbound" || dir === "received") {
      return { label: "Chat received", dotColor: "#40b9ff", badgeClass: "activity-badge-blue" };
    }
    return { label: "Chat reply", dotColor: "#22c55e", badgeClass: "activity-badge-green" };
  }
  if (channel === "email" || channel === "agentmail") {
    if (dir === "inbound" || dir === "received") {
      return { label: "Email received", dotColor: "#40b9ff", badgeClass: "activity-badge-blue" };
    }
    return { label: "Email sent", dotColor: "#22c55e", badgeClass: "activity-badge-green" };
  }
  if (channel === "slack") {
    if (dir === "inbound") {
      return { label: "Slack received", dotColor: "#40b9ff", badgeClass: "activity-badge-blue" };
    }
    return { label: "Slack sent", dotColor: "#22c55e", badgeClass: "activity-badge-green" };
  }
  if (channel === "voice") {
    return { label: "Voice call", dotColor: "#a855f7", badgeClass: "activity-badge-purple" };
  }
  if (channel === "heartbeat") {
    return { label: "Heartbeat", dotColor: "#8b949e", badgeClass: "activity-badge-gray" };
  }
  return { label: event.kind || "Activity", dotColor: "#8b949e", badgeClass: "activity-badge-gray" };
}

export function ExecutionHistory({
  employeeId,
  initialHistory,
  className = "",
}: {
  employeeId: string;
  initialHistory: HistoryEvent[];
  className?: string;
}) {
  const [history, setHistory] = useState(initialHistory);
  const [filter, setFilter] = useState<"all" | "emails" | "tools">("all");
  const [visibleCount, setVisibleCount] = useState(10);

  useEffect(() => {
    const supabase = createClient();
    const sync = async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, channel, kind, payload, created_at")
        .eq("employee_id", employeeId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);
      if (error) {
        console.error("[execution-history] Failed to sync events", error);
        return;
      }
      setHistory((current) => mergeHistory(data, current));
    };

    const channel = supabase
      .channel(`employee-history:${employeeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `employee_id=eq.${employeeId}`,
        },
        (payload) =>
          setHistory((current) =>
            mergeHistory([payload.new as HistoryEvent], current),
          ),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void sync();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [employeeId]);

  const filtered = useMemo(() => {
    if (filter === "emails") {
      return history.filter((e) => {
        if (e.kind === "tool") return false;
        const p = e.payload as { actual_channel?: string } | undefined;
        const ch = (p?.actual_channel || e.channel || "").toLowerCase();
        return ch === "email" || ch === "agentmail";
      });
    }
    if (filter === "tools") {
      return history.filter((e) => e.kind === "tool");
    }
    return history;
  }, [history, filter]);

  return (
    <Card className={`profile-card activity-card ${className}`}>
      <div className="activity-header">
        <h2 className="activity-title">Activity</h2>
        <div className="activity-filter-pills">
          <button
            type="button"
            className={`activity-filter-btn ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`activity-filter-btn ${filter === "emails" ? "active" : ""}`}
            onClick={() => setFilter("emails")}
          >
            Emails
          </button>
          <button
            type="button"
            className={`activity-filter-btn ${filter === "tools" ? "active" : ""}`}
            onClick={() => setFilter("tools")}
          >
            Tools
          </button>
        </div>
      </div>

      <div className="activity-list">
        {filtered.length === 0 ? (
          <p className="activity-empty-state">No activity recorded yet.</p>
        ) : (
          filtered.slice(0, visibleCount).map((event) => {
            const payload = event.payload as {
              direction?: string;
              text?: string;
              tool?: string;
              successful?: boolean;
              error?: string | null;
            };
            const badge = getEventBadge(event);

            return (
              <div key={event.id} className="activity-item">
                <div className="activity-item-header">
                  <div className="activity-item-badge-wrap">
                    <span
                      className="activity-item-dot"
                      style={{ backgroundColor: badge.dotColor }}
                    />
                    <span className={`activity-item-badge ${badge.badgeClass}`}>
                      {badge.label}
                    </span>
                  </div>
                  <span className="activity-item-time">
                    {formatTime(event.created_at)}
                  </span>
                </div>

                <div className="activity-item-text">
                  {payload.text
                    ? renderBold(payload.text)
                    : event.kind === "tool"
                      ? formatToolEvent(payload)
                      : `(${event.kind})`}
                </div>
              </div>
            );
          })
        )}
      </div>

      {filtered.length > visibleCount && (
        <button
          type="button"
          className="activity-load-more-btn"
          onClick={() => setVisibleCount((prev) => prev + 10)}
        >
          Load earlier activity
        </button>
      )}
    </Card>
  );
}
