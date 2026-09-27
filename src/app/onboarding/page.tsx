import Link from "next/link";
import { redirect } from "next/navigation";
import { getPrisma } from "../../auth/db";
import { getOnboardingState } from "../../onboarding/service";
import { requirePageUser } from "../protected-user";
import { ProfileForm, ProgrammeForm, TermForm } from "./forms";

type Step = "profile" | "programme" | "term";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const currentUser = await requirePageUser();
  const state = await getOnboardingState(getPrisma(), currentUser);
  if (state.complete) redirect("/home");
  const query = await searchParams;
  const requested = query.step;
  const step: Step = !state.profile ? "profile" : requested === "profile" || requested === "term" ? requested : "programme";
  const ordinal = step === "profile" ? 1 : step === "programme" ? 2 : 3;

  return <main className="mx-auto min-h-screen max-w-2xl px-4 py-10 sm:py-16">
    <div className="mb-8 flex items-center justify-between">
      <Link href="/" className="font-semibold tracking-wide text-indigo-700">UniOS</Link>
      <span className="text-sm text-slate-500">Step {ordinal} of 3</span>
    </div>
    <div className="mb-8 flex gap-2" aria-label="Setup progress">
      {[1, 2, 3].map((number) => <div key={number} className={`h-1.5 flex-1 rounded-full ${number <= ordinal ? "bg-indigo-700" : "bg-slate-200"}`} />)}
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-medium text-indigo-700">Welcome to UniOS</p>
      <h1 className="mt-2 text-2xl font-semibold">
        {step === "profile" ? "Set up your profile" : step === "programme" ? "Add your programme" : "Create your first term"}
      </h1>
      <p className="mb-7 mt-2 text-sm text-slate-600">
        {step === "profile" ? "Choose the timezone used for your personal workspace." :
          step === "programme" ? "Programme details are optional. You can skip this step." :
          "Your first term is required before you can use the workspace."}
      </p>
      {step === "profile" && <ProfileForm displayName={state.profile?.displayName ?? null} initialTimezone={state.profile?.timezone ?? null} />}
      {step === "programme" && <ProgrammeForm name={state.programme?.name ?? null} description={state.programme?.description ?? null} />}
      {step === "term" && <TermForm initialTimezone={state.profile?.timezone ?? "UTC"} />}
    </section>
  </main>;
}
