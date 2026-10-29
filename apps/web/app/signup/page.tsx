import { redirect } from "next/navigation";
import { getOrgContext } from "../../lib/auth";
import { AteLogo } from "../ate-logo";
import { SignupForm } from "./signup-form";
import "../public.css";

export default async function SignupPage() {
  const ctx = await getOrgContext();
  if (ctx) redirect("/dashboard");
  return (
    <div className="public-page">
      <main className="auth-main">
        <AteLogo />
        <section className="auth-panel">
          <h1>Create your org</h1>
          <p className="auth-panel-intro">
            Set up your workspace and start hiring.
          </p>
          <SignupForm />
        </section>
      </main>
    </div>
  );
}
