"use client";

import { useEffect } from "react";

/**
 * Sign-out page. The nav CTA is a next/link, and prefetching a page is
 * side-effect free (client effects never run on prefetch) — unlike the GET
 * route handler this replaces, which prefetch executed, signing users out
 * immediately after login. The actual sign-out happens via POST on mount,
 * then a hard navigation to /login so no cached authenticated UI survives.
 */
export default function LogoutPage() {
  useEffect(() => {
    fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      window.location.replace("/login");
    });
  }, []);

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
      <p>Signing out…</p>
    </main>
  );
}
