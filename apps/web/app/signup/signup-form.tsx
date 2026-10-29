"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@ate/design/components/Button";

/**
 * Signup form (F2 auth). Creates the org + admin user via the service-role
 * route, then signs in server-side (so the session cookie is set reliably) and
 * navigates to the dashboard.
 */
export function SignupForm() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        org_name: orgName,
        full_name: fullName,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Signup failed");
      setPending(false);
      return;
    }

    const loginRes = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      const body = await loginRes.json().catch(() => ({}));
      setError(body.error ?? "Sign-in failed");
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="auth-form">
      <label className="auth-field">
        <span>Organization name</span>
        <input
          required
          autoComplete="organization"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
        />
      </label>
      <label className="auth-field">
        <span>Your name</span>
        <input
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </label>
      <label className="auth-field">
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="auth-field">
        <span>Password</span>
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="auth-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="blue" disabled={pending}>
        {pending ? "Creating…" : "Create org"}
      </Button>
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}
