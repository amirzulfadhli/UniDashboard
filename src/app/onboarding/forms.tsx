"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "./actions";
import { completeTermAction, saveProfileAction, saveProgrammeAction, skipProgrammeAction } from "./actions";

const initial: ActionState = { error: null };
const inputClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-indigo-600";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="rounded-lg bg-indigo-700 px-5 py-2.5 font-medium text-white hover:bg-indigo-800 disabled:opacity-60">{pending ? "Saving…" : children}</button>;
}

function ErrorMessage({ error }: ActionState) {
  return error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null;
}

export function ProfileForm({ displayName, initialTimezone }: { displayName: string | null; initialTimezone: string | null }) {
  const [state, action] = useActionState(saveProfileAction, initial);
  const [timezone, setTimezone] = useState(initialTimezone ?? "UTC");
  useEffect(() => {
    if (!initialTimezone) setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, [initialTimezone]);
  return <form action={action} className="space-y-5">
    <label className="block text-sm font-medium">Display name <span className="font-normal text-slate-500">(optional)</span>
      <input name="displayName" defaultValue={displayName ?? ""} maxLength={120} autoComplete="name" className={inputClass} />
    </label>
    <label className="block text-sm font-medium">Timezone
      <input name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} required autoComplete="off" placeholder="e.g. Europe/London" className={inputClass} />
      <span className="mt-1 block text-xs font-normal text-slate-500">Use an IANA timezone. You can change the detected value.</span>
    </label>
    <ErrorMessage error={state.error} /><Submit>Continue</Submit>
  </form>;
}

export function ProgrammeForm({ name, description }: { name: string | null; description: string | null }) {
  const [state, action] = useActionState(saveProgrammeAction, initial);
  return <div className="space-y-4">
    <form action={action} className="space-y-5">
      <label className="block text-sm font-medium">Programme name
        <input name="name" defaultValue={name ?? ""} required maxLength={200} placeholder="e.g. Computer Science" className={inputClass} />
      </label>
      <label className="block text-sm font-medium">Description <span className="font-normal text-slate-500">(optional)</span>
        <textarea name="description" defaultValue={description ?? ""} maxLength={2000} rows={3} className={inputClass} />
      </label>
      <ErrorMessage error={state.error} /><Submit>Save and continue</Submit>
    </form>
    <form action={skipProgrammeAction}><button className="text-sm font-medium text-indigo-700 underline">Skip programme</button></form>
  </div>;
}

export function TermForm({ initialTimezone }: { initialTimezone: string }) {
  const [state, action] = useActionState(completeTermAction, initial);
  return <form action={action} className="space-y-5">
    <label className="block text-sm font-medium">Term name
      <input name="name" required maxLength={200} placeholder="e.g. Autumn 2026" className={inputClass} />
    </label>
    <label className="block text-sm font-medium">Academic timezone
      <input name="academicTimezone" required defaultValue={initialTimezone} className={inputClass} />
    </label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">Start date<input name="startsOn" type="date" required className={inputClass} /></label>
      <label className="block text-sm font-medium">End date<input name="endsOn" type="date" required className={inputClass} /></label>
    </div>
    <label className="block text-sm font-medium">Teaching start date
      <input name="teachingStartsOn" type="date" required className={inputClass} />
    </label>
    <ErrorMessage error={state.error} /><Submit>Finish setup</Submit>
  </form>;
}
