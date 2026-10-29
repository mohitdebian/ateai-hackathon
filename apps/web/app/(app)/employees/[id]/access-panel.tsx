"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@ate/design/components/Button";
import { Card } from "@ate/design/components/Card";

interface Connection {
  provider: string;
}

interface Toolkit {
  slug: string;
  name: string;
  logo?: string;
}

/** Enough to scroll without rendering all ~1000 matches into the DOM. */
const MAX_VISIBLE = 50;

/**
 * Grant access step (docs/product.md "Vision"). Search the Composio catalog (#42),
 * pick an app → managed OAuth opens in a new tab → the connection appears once
 * Composio confirms the grant. Abandoning the flow lists nothing, so every app
 * shown here is genuinely connected and usable by the worker (#156).
 */
export function AccessPanel({
  employeeId,
  className,
  style,
}: {
  employeeId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [configured, setConfigured] = useState(true);
  const [toolkits, setToolkits] = useState<Toolkit[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listboxId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/employees/${employeeId}/connections`);
    if (res.ok) {
      const body = await res.json();
      setConnections(body.connections ?? []);
      setConfigured(body.configured ?? false);
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  // OAuth finishes in a popup that closes itself (#94), and `noopener` means it
  // can't tell us. Re-check when this tab comes back into focus, so a completed
  // grant shows up without a manual refresh.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // The catalog is static, so it loads once and every keystroke filters locally.
  useEffect(() => {
    fetch("/api/toolkits")
      .then((r) => (r.ok ? r.json() : { toolkits: [] }))
      .then((b) => setToolkits(b.toolkits ?? []))
      .catch(() => setToolkits([]));
  }, []);

  // Close on outside click, so the list doesn't sit over the rest of the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const connected = useMemo(
    () => new Set(connections.map((c) => c.provider)),
    [connections],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return toolkits
      .filter((t) => !connected.has(t.slug))
      .filter(
        (t) => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q),
      )
      .slice(0, MAX_VISIBLE);
  }, [toolkits, connected, query]);

  async function connect(toolkit: string) {
    setError(null);
    setPending(toolkit);
    const res = await fetch(`/api/employees/${employeeId}/connections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit }),
    });
    setPending(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not start the connection");
      return;
    }
    if (body.redirectUrl) window.open(body.redirectUrl, "_blank", "noopener");
    setQuery("");
    setOpen(false);
    load();
  }

  async function disconnect(provider: string) {
    setError(null);
    setDisconnecting(provider);
    const res = await fetch(`/api/employees/${employeeId}/connections`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolkit: provider }),
    });
    setDisconnecting(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not disconnect. Try again");
      return;
    }
    setConfirming(null);
    load();
  }

  // Typed text is always connectable: the catalog caps at 1000 entries, and a
  // private or newly added toolkit may not be in it at all.
  const typed = query.trim().toLowerCase();
  const showTypedFallback =
    typed.length > 0 && !matches.some((t) => t.slug === typed);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(next, matches.length - 1));
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = matches[active];
      if (picked) connect(picked.slug);
      else if (typed) connect(typed);
      return;
    }
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <Card className={`profile-card access-panel-card ${className ?? ""}`} style={style}>
      <div className="app-access-head">
        <div className="app-access-title-row">
          <h2 className="app-access-title">App access</h2>
          <Button variant="ghost" className="app-access-refresh-btn" onClick={load}>
            Refresh
          </Button>
        </div>
        <p className="app-access-hint">
          Apps this employee can use. Sign-in is handled by managed OAuth and you can remove access at any time.
        </p>
      </div>

      {!configured ? (
        <p className="muted" style={{ fontSize: 14 }}>
          COMPOSIO_API_KEY is not configured. See apps/web/.env.example.
        </p>
      ) : (
        <div ref={boxRef} className="access-search">
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && matches[active] ? `${listboxId}-${active}` : undefined
            }
            placeholder="Search apps: Gmail, Notion, HubSpot"
            value={query}
            disabled={pending !== null}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="access-search-input"
          />

          {open && (matches.length > 0 || showTypedFallback) ? (
            <ul id={listboxId} role="listbox" className="access-listbox">
              {matches.map((t, i) => (
                <li
                  key={t.slug}
                  id={`${listboxId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    connect(t.slug);
                  }}
                  className={`access-option${i === active ? " active" : ""}`}
                >
                  {t.logo ? (
                    // Plain <img>: these are remote Composio CDN logos, and next/image
                    // would need every logo host in next.config remotePatterns.
                    <img src={t.logo} alt="" className="access-option-logo" />
                  ) : (
                    <span className="access-option-logo access-option-logo-blank" />
                  )}
                  <span className="access-option-name">{t.name}</span>
                  <span className="access-option-slug">{t.slug}</span>
                </li>
              ))}
              {showTypedFallback ? (
                <li
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    connect(typed);
                  }}
                  className="access-option access-option-fallback"
                >
                  Connect &ldquo;{typed}&rdquo; anyway
                </li>
              ) : null}
            </ul>
          ) : null}

          {pending ? (
            <p className="access-status">Opening {pending}&hellip;</p>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="access-error">
          {error}
        </p>
      ) : null}

      {connections.length > 0 ? (
        <div className="access-connections">
          <ul className="access-connection-list">
            {connections.map((c) => {
              const toolkit = toolkits.find((t) => t.slug === c.provider);
              const name = toolkit?.name ?? c.provider;
              const initialsName = name
                .split(" ")
                .map((n: string) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              return (
                <li key={c.provider} className="app-access-row">
                  <div className="app-access-item-left">
                    {toolkit?.logo ? (
                      <img
                        src={toolkit.logo}
                        alt=""
                        className="app-access-logo"
                      />
                    ) : (
                      <span className="app-access-avatar">{initialsName}</span>
                    )}
                    <div className="app-access-item-info">
                      <strong>{name}</strong>
                      <span className="app-access-item-perm">Read and write</span>
                    </div>
                  </div>

                  <div className="app-access-item-right">
                    <span className="app-access-badge-active">Active</span>
                    {confirming === c.provider ? (
                      <div className="access-connection-actions">
                        <Button
                          variant="dark"
                          className="btn-sm"
                          disabled={disconnecting === c.provider}
                          onClick={() => disconnect(c.provider)}
                        >
                          {disconnecting === c.provider ? "..." : "Confirm"}
                        </Button>
                        <Button
                          variant="ghost"
                          className="btn-sm"
                          disabled={disconnecting === c.provider}
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="app-access-remove-btn"
                        onClick={() => setConfirming(c.provider)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
