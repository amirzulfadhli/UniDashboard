"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "../auth/client";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const registering = mode === "sign-up";

  async function submit(formData: FormData) {
    setError("");
    setSubmitting(true);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    try {
      const response = registering
        ? await authClient.signUp.email({ email, password, name: String(formData.get("name") ?? "").trim() })
        : await authClient.signIn.email({ email, password });
      if (response.error) {
        setError(response.error.message ?? "Authentication failed. Please try again.");
        setSubmitting(false);
        return;
      }
      startTransition(() => router.replace("/onboarding"));
    } catch {
      setError("Could not connect. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Link href="/" className="text-sm font-semibold tracking-wide text-indigo-700">UniOS</Link>
        <h1 className="mt-5 text-2xl font-semibold">{registering ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-2 text-sm text-slate-600">{registering ? "Set up your academic workspace." : "Sign in to continue to your workspace."}</p>
        <form action={submit} className="mt-7 space-y-4">
          {registering && <label className="block text-sm font-medium">Name
            <input name="name" autoComplete="name" required maxLength={120} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-indigo-600" />
          </label>}
          <label className="block text-sm font-medium">Email
            <input name="email" type="email" autoComplete="email" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-indigo-600" />
          </label>
          <label className="block text-sm font-medium">Password
            <input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={8} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-indigo-600" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button disabled={submitting || navigating} className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 font-medium text-white hover:bg-indigo-800 disabled:opacity-60">
            {submitting || navigating ? "Please wait…" : registering ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          {registering ? "Already have an account? " : "New to UniOS? "}
          <Link href={registering ? "/sign-in" : "/sign-up"} className="font-medium text-indigo-700 underline">
            {registering ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
