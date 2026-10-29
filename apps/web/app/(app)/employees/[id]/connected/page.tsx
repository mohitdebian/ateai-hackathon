"use client";

import { useEffect, useState } from "react";

/**
 * Composio's managed-OAuth return page (#94). The callback used to point at the
 * employee profile, which stranded the user in the popup on a not-yet-hired
 * employee — showing unprovisioned channels and a "retry provisioning" prompt
 * mid-wizard. This is a terminal page: it closes the popup and sends the user
 * back to the tab they were already working in. It must not redirect.
 */
export default function ConnectedPage() {
  const [closeFailed, setCloseFailed] = useState(false);

  useEffect(() => {
    // Only works for script-opened tabs — which this is, via window.open in
    // AccessPanel. If the browser refuses, fall through to the message below.
    window.close();
    const timer = setTimeout(() => setCloseFailed(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="connected-page">
      <section className="card">
        <h1>App connected</h1>
        <p className="muted">
          {closeFailed
            ? "You can close this tab and continue where you left off."
            : "You can close this tab."}
        </p>
      </section>
    </main>
  );
}
