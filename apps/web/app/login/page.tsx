import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrgContext } from "../../lib/auth";
import { AteLogo } from "../ate-logo";
import { LoginForm } from "./login-form";
import "../public.css";

export default async function LoginPage() {
  const ctx = await getOrgContext();
  if (ctx) redirect("/dashboard");
  return (
    <div className="auth-split-layout">
      {/* Left Column: Form & Actions */}
      <div className="auth-split-left">
        <header className="auth-split-header">
          <Link href="/" aria-label="ate.ai home">
            <AteLogo size={24} />
          </Link>
        </header>

        <main className="auth-split-form-wrap">
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">
            Sign in to manage your digital workforce.
          </p>
          <LoginForm />
        </main>

        <footer className="auth-split-footer">
          <a href="#">Security</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">System status</a>
        </footer>
      </div>

      {/* Right Column: Hero Showcase */}
      <aside className="auth-split-right" aria-hidden="true">
        <div className="auth-hero-content">
          <h2 className="auth-hero-title">
            AI employees you can actually manage.
          </h2>
          <p className="auth-hero-sub">
            Their own inbox, phone line, and Slack handle, inside the limits you set.
          </p>

          <div className="auth-hero-tree">
            <div className="auth-hero-card auth-hero-card-manager">
              <div className="auth-hero-avatar">TE</div>
              <div className="auth-hero-card-info">
                <strong>texter</strong>
                <span>Manager</span>
              </div>
            </div>

            <div className="auth-hero-connector" />

            <div className="auth-hero-card auth-hero-card-employee">
              <div className="auth-hero-avatar auth-hero-avatar-ja">JA</div>
              <div className="auth-hero-card-info">
                <strong>Jordan Avery</strong>
                <span>Staff Accountant</span>
              </div>
              <div className="auth-hero-status">
                <span className="auth-hero-dot" />
                <span>Waiting for your approval</span>
              </div>
            </div>
          </div>

          <div className="auth-hero-features">
            <div className="auth-hero-feature">
              <svg
                className="auth-hero-feature-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <div>
                <strong>Every action is logged.</strong>
                <p>See what was done, in which system, and why.</p>
              </div>
            </div>

            <div className="auth-hero-feature">
              <svg
                className="auth-hero-feature-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <div>
                <strong>Limits sit outside the model.</strong>
                <p>Refund caps and scopes can't be talked around.</p>
              </div>
            </div>

            <div className="auth-hero-feature">
              <svg
                className="auth-hero-feature-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <line x1="12" y1="2" x2="12" y2="12" />
              </svg>
              <div>
                <strong>One switch pauses everyone.</strong>
                <p>Stop all employees instantly, resume when ready.</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
