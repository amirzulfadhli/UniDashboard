"use client";

import { useState } from "react";
import { authClient } from "../../auth/client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setPending(true);
    setError("");
    try {
      const response = await authClient.signOut();
      if (response.error) {
        setError(response.error.message ?? "Could not sign out.");
        setPending(false);
        return;
      }
      window.location.assign("/sign-in");
    } catch {
      setError("Could not connect. Please try again.");
      setPending(false);
    }
  }
  return <div className="text-right">
    <button onClick={signOut} disabled={pending} className="text-sm font-medium text-indigo-700 underline disabled:opacity-60">{pending ? "Signing out…" : "Sign out"}</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
