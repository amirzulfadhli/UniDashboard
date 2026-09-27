import Link from "next/link";
import { getPrisma } from "../../auth/db";
import { listTerms } from "../../academic/records";
import { literalDate } from "../../academic/validation";
import { requirePageUser } from "../protected-user";
import { AcademicShell, Hidden, Submit, TermFields } from "../academic-ui";
import { archiveTermAction, createTermAction, selectTermAction, termLifecycleAction, updateTermAction } from "../academic-actions";

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const owner = await requirePageUser();
  const prisma = getPrisma();
  const [terms, profile, search] = await Promise.all([listTerms(prisma, owner, true), prisma.profile.findUnique({ where: { ownerId: owner.id } }), searchParams]);
  return <AcademicShell title="Terms" error={search.error}><section><h2>Create term</h2><form action={createTermAction}><TermFields /><Submit>Create term</Submit></form></section>
    {terms.map((term) => <section key={term.id}><h2>{term.name} {profile?.selectedTermId === term.id && "· Selected"}</h2><p>{term.status}{term.archivedAt && " · Archived"} · {term.academicTimezone}</p>
      <div className="flex flex-wrap gap-3">{!term.archivedAt && <><form action={selectTermAction}><Hidden name="id" value={term.id} /><Submit>Select term</Submit></form><Link href={`/courses?term=${term.id}`}>Manage courses</Link></>}
        <form action={archiveTermAction}><Hidden name="id" value={term.id} /><Hidden name="archived" value={term.archivedAt ? "false" : "true"} /><Submit>{term.archivedAt ? "Restore term" : "Archive term"}</Submit></form>
        <form action={termLifecycleAction}><Hidden name="id" value={term.id} /><label>Lifecycle<select name="status" defaultValue={term.status}><option>PLANNED</option><option>ACTIVE</option><option>CLOSED</option></select></label><Submit>Change lifecycle</Submit></form></div>
      <details><summary>Edit term</summary><form action={updateTermAction}><Hidden name="id" value={term.id} /><TermFields data={{ name: term.name, startsOn: literalDate(term.startsOn), endsOn: literalDate(term.endsOn), teachingStartsOn: literalDate(term.teachingStartsOn), academicTimezone: term.academicTimezone }} /><Submit>Save term</Submit></form></details>
    </section>)}</AcademicShell>;
}
