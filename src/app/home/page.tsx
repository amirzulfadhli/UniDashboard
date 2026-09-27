import { redirect } from "next/navigation";
import { getPrisma } from "../../auth/db";
import { getOnboardingState } from "../../onboarding/service";
import { requirePageUser } from "../protected-user";
import { SignOutButton } from "./sign-out-button";

export default async function HomePage() {
  const currentUser = await requirePageUser();
  const prisma = getPrisma();
  const state = await getOnboardingState(prisma, currentUser);
  if (!state.complete || !state.selectedTerm) redirect("/onboarding");
  const identity = await prisma.authUser.findUnique({ where: { domainUserId: currentUser.id }, select: { email: true } });
  if (!identity) throw new Error("Authenticated identity mapping is missing.");

  return <main className="min-h-screen">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <span className="font-semibold tracking-wide text-indigo-700">UniOS</span><SignOutButton />
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
    </div>
  </main>;
}
