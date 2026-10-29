"use client";

import { useEffect, useState, useCallback } from "react";
import { formatToolEvent } from "../../../lib/format-event";

interface Event {
  id: string;
  employee_name: string;
  channel: string;
  kind: string;
  payload: {
    direction?: string;
    text?: string;
    tool?: string;
    successful?: boolean;
    error?: string | null;
  };
  created_at: string;
}

/** A feed row: one event, plus any consecutive tool events it absorbed. */
interface RowGroup {
  event: Event;
  extraTools: number;
}

/** Collapse runs of consecutive tool events from the same employee into one row. */
function groupEvents(events: Event[]): RowGroup[] {
  const groups: RowGroup[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (
      last &&
      event.kind === "tool" &&
      last.event.kind === "tool" &&
      last.event.employee_name === event.employee_name
    ) {
      last.extraTools += 1;
    } else {
      groups.push({ event, extraTools: 0 });
    }
  }
  return groups;
}

const FRESH_MS = 90_000;

/**
 * Activity rail (docs/product.md "Design vision"): always present, collapsed by default, streaming
 * what employees are doing now. Polls the events feed for near-real-time.
 * (The top is reserved for the approval queue once approval gates land.)
 */
export function ActivityRail() {
  const [events, setEvents] = useState<Event[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/events?limit=40");
    if (res.ok) setEvents((await res.json()).events ?? []);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <aside className="activity-rail">
      <div className="activity-header">Activity</div>
      <div className="activity-list">
        {events.length === 0 ? (
          <p className="activity-empty">No activity yet.</p>
        ) : (
          groupEvents(events).map((g, i) => (
            <Row
              key={g.event.id}
              event={g.event}
              extraTools={g.extraTools}
              fresh={
                i === 0 &&
                Date.now() - new Date(g.event.created_at).getTime() < FRESH_MS
              }
            />
          ))
        )}
      </div>
    </aside>
  );
}

function Row({
  event,
  extraTools,
  fresh,
}: {
  event: Event;
  extraTools: number;
  fresh: boolean;
}) {
  const dir = event.payload?.direction;
  const isTool = event.kind === "tool";
  let text =
    event.payload?.text ||
    (isTool ? formatToolEvent(event.payload) : `(${event.kind})`);
  if (extraTools > 0)
    text += ` · +${extraTools} more action${extraTools > 1 ? "s" : ""}`;
  return (
    <div className="activity-row">
      <div className="activity-meta">
        <span>{event.employee_name}</span>
        <span>{fresh ? "Now" : `${event.channel} · ${dir ?? event.kind}`}</span>
      </div>
      <div className="activity-text">{text}</div>
    </div>
  );
}
