import { redirect } from "next/navigation";
import Link from "next/link";
import { getPrisma } from "../../auth/db";
import { getOnboardingState } from "../../onboarding/service";
import { requirePageUser } from "../protected-user";
import { SignOutButton } from "./sign-out-button";
import { nextClass, todaysClasses } from "../../academic/queries";
import { academicDate } from "../../academic/recurrence";

export default async function HomePage() {
  const currentUser = await requirePageUser();
  const prisma = getPrisma();
  const state = await getOnboardingState(prisma, currentUser);
  if (!state.selectedTerm && state.profile && state.firstTerm) redirect("/terms");
  if (!state.complete || !state.selectedTerm) redirect("/onboarding");
  const [today, next] = await Promise.all([
    todaysClasses(prisma, currentUser, academicDate(new Date(), state.selectedTerm.academicTimezone), state.selectedTerm.academicTimezone),
    nextClass(prisma, currentUser),
  ]);
  const identity = await prisma.authUser.findUnique({ where: { domainUserId: currentUser.id }, select: { email: true } });
  if (!identity) throw new Error("Authenticated identity mapping is missing.");

  return <main className="min-h-screen">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <span className="font-semibold tracking-wide text-indigo-700">UniOS</span><nav className="flex gap-4" aria-label="Academic navigation"><Link href="/terms">Terms</Link><Link href="/courses">Courses</Link><Link href="/timetable">Timetable</Link></nav><SignOutButton />
      </div>
    </header>
    <div className="mx-auto max-w-5xl px-4 py-10">
      <p className="text-sm font-medium text-indigo-700">Workspace ready</p>
      <h1 className="mt-2 text-3xl font-semibold">{state.profile?.displayName ? `Welcome, ${state.profile.displayName}` : "Welcome"}</h1>
      <p className="mt-3 text-slate-600">Your account and first term are set up.</p>
      <p className="mt-2 text-sm text-slate-500">Signed in as {identity.email}</p>
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Selected term</h2>
        <p className="mt-2 text-slate-700">{state.selectedTerm.name}</p>
        <p className="mt-1 text-sm text-slate-500">{state.selectedTerm.academicTimezone}</p>
      </section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Today's classes</h2>
        {today.length ? today.map((occurrence) => <p key={`${occurrence.scheduleId}:${occurrence.originalDate}`}>{occurrence.courseCode} · {occurrence.startsAt.toLocaleString("en-GB", { timeZone: occurrence.timezone })} · {occurrence.location ?? "No location"}</p>) : <p>No active classes today.</p>}
        <h2 className="mt-4 font-semibold">Next class</h2>{next ? <p>{next.courseCode} · {next.startsAt.toLocaleString("en-GB", { timeZone: next.timezone })} · {next.timezone}</p> : <p>No upcoming class.</p>}<Link className="mt-3 inline-block text-indigo-700" href="/timetable">Open weekly timetable</Link>
      </section>
    </div>
  </main>;
}
