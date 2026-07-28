"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/review";
}

export default function StaffLoginForm() {
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/staff-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Staff sign-in failed.");
      window.location.assign(safeNext(searchParams.get("next")));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Staff sign-in failed.");
      setSubmitting(false);
    }
  }

  return (
    <form className="staff-login-form" onSubmit={signIn}>
      <label>Staff username<input autoComplete="username" onChange={(event) => setUsername(event.target.value)} required value={username} /></label>
      <label>Staff password<input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
      <button disabled={submitting} type="submit">{submitting ? "Signing in..." : "Sign in"}</button>
      {message ? <p role="alert">{message}</p> : null}
    </form>
  );
}
