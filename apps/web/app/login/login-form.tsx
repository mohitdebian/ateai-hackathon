"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@ate/design/components/Button";

/**
 * Login form (F2 auth). Signs in via the server route so the session cookie is
 * set server-side (reliable across hosts); the middleware then enforces it.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Sign-in failed");
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="auth-form">
      <div className="auth-field">
        <label htmlFor="auth-email">Work email</label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="auth-field">
        <div className="auth-field-header">
          <label htmlFor="auth-password">Password</label>
          <button
            type="button"
            className="auth-link-btn"
            onClick={() =>
              setInfo("Please contact your workspace administrator to reset your password.")
            }
          >
            Forgot password?
          </button>
        </div>
        <div className="auth-input-wrapper">
          <input
            id="auth-password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="auth-password-toggle"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <label className="auth-checkbox-label">
        <input
          type="checkbox"
          checked={keepSignedIn}
          onChange={(e) => setKeepSignedIn(e.target.checked)}
        />
        <span>Keep me signed in on this device</span>
      </label>

      {error ? (
        <p role="alert" className="auth-error">
          {error}
        </p>
      ) : null}

      {info ? (
        <p role="status" className="auth-info">
          {info}
        </p>
      ) : null}

      <Button type="submit" variant="blue" className="auth-submit-btn" disabled={pending}>
        {pending ? "Signing in…" : "Sign In"}
      </Button>

      <p className="auth-switch">
        New to ate.ai? <Link href="/signup">Create your org</Link>
      </p>
    </form>
  );
}
