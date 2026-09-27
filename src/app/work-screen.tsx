import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Temporal } from "@js-temporal/polyfill";
import { AcademicError } from "../academic/errors";
import { academicDate } from "../academic/recurrence";
import { literalDate } from "../academic/validation";
import { getPrisma } from "../auth/db";
import { queryWork, workOptions, type WorkView } from "../work/queries";
import { activeStatus } from "../work/service";
import { type WorkKind } from "../work/validation";
import { AcademicShell, Hidden, Submit } from "./academic-ui";
import { requirePageUser } from "./protected-user";
import { archiveWorkAction, createWorkAction, deadlineAction, updateWorkAction, workLifecycleAction } from "./work-actions";
import { DeadlineFields, WorkFields, type Choices } from "./work-fields";

const states = { TASK: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"], PROJECT: ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"], ASSIGNMENT: ["NOT_STARTED", "IN_PROGRESS", "READY_TO_SUBMIT", "SUBMITTED", "GRADED", "CANCELLED"] };
type Search = { view?: string; kind?: string; course?: string; project?: string; date?: string; startDate?: string; endDate?: string; error?: string };
export async function WorkScreen({ search, projectsOnly = false }: { search: Search; projectsOnly?: boolean }) {
  const owner = await requirePageUser(); const prisma = getPrisma();
  const profile = await prisma.profile.findUnique({ where: { ownerId: owner.id } });
  if (!profile) redirect("/onboarding");
  const now = new Date(); const today = academicDate(now, profile.timezone);
  const startDate = search.startDate ?? today, endDate = search.endDate ?? Temporal.PlainDate.from(today).add({ days: 30 }).toString();
  const view = projectsOnly ? "MANAGEMENT" : (search.view ?? "ACTIVE") as WorkView;
  let rows, options;
  try {
    rows = await queryWork(prisma, owner, { view, now, kind: projectsOnly ? "PROJECT" : search.kind || undefined, courseId: search.course || undefined, projectId: search.project || undefined, includeArchived: view === "MANAGEMENT", date: search.date, startDate, endDate, start: now, end: new Date(now.getTime() + 30 * 86400000) });
    options = await workOptions(prisma, owner);
  } catch (error) { if (error instanceof AcademicError) notFound(); throw error; }
  const choices: Choices = {
    terms: options.terms.map((row) => ({ id: row.id, label: row.name, eligible: !row.archivedAt && row.status !== "CLOSED" })),
    courses: options.courses.map((row) => ({ id: row.id, label: `${row.courseCode} · ${row.title}`, eligible: !row.archivedAt && ["UPCOMING", "ACTIVE"].includes(row.status) && !row.term.archivedAt && row.term.status !== "CLOSED" })),
    projects: options.projects.map((row) => ({ id: row.id, label: row.title, eligible: !row.archivedAt && activeStatus("PROJECT", row.status) })),
    assignments: options.assignments.map((row) => ({ id: row.id, label: row.title, eligible: !row.archivedAt && activeStatus("ASSIGNMENT", row.status) && !row.course.archivedAt && ["UPCOMING", "ACTIVE"].includes(row.course.status) && !row.course.term.archivedAt && row.course.term.status !== "CLOSED" })),
  };
  const returnTo = projectsOnly ? "/projects" : "/work";
  const identity = (kind: WorkKind, id?: string) => <><Hidden name="kind" value={kind} /><Hidden name="returnTo" value={returnTo} />{id && <Hidden name="id" value={id} />}</>;
  return <AcademicShell title={projectsOnly ? "Projects" : "Work"} error={search.error}>
    <nav aria-label="Work views" className="flex flex-wrap gap-4">{["ACTIVE", "TODAY", "UPCOMING", "OVERDUE", "MANAGEMENT"].map((value) => <Link key={value} href={`/work?view=${value}`}>{value.replace("TODAY", "Due today").toLowerCase()}</Link>)}<Link href="/projects">Projects</Link></nav>
    {!projectsOnly && <form method="get"><label>View<select name="view" defaultValue={view}>{["ACTIVE", "TODAY", "DUE_ON", "UPCOMING", "OVERDUE", "MANAGEMENT"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Kind<select name="kind" defaultValue={search.kind ?? ""}><option value="">All</option>{["TASK", "PROJECT", "ASSIGNMENT"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Course<select name="course" defaultValue={search.course ?? ""}><option value="">All</option>{choices.courses.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><label>Project<select name="project" defaultValue={search.project ?? ""}><option value="">All</option>{choices.projects.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><label>Requested local due date<input name="date" type="date" defaultValue={search.date ?? today} /></label><label>Upcoming first date<input name="startDate" type="date" defaultValue={startDate} /></label><label>Upcoming last date<input name="endDate" type="date" defaultValue={endDate} /></label><Submit>Filter work</Submit></form>}
    <p>Upcoming dates include both boundaries. Timed upcoming work covers the next 30 days. Date-only deadlines use their stored timezone; unfinished work remains visible when its historical context is archived.</p>
    {(projectsOnly ? ["PROJECT"] : ["TASK", "ASSIGNMENT", "PROJECT"]).map((value) => { const kind = value as WorkKind; return <section key={kind}><details><summary>Create {kind.toLowerCase()}</summary><form action={createWorkAction}>{identity(kind)}<WorkFields kind={kind} choices={choices} /><DeadlineFields timezone={profile.timezone} allowNone /><Submit>Create {kind.toLowerCase()}</Submit></form></details></section>; })}
    <h2>{view.toLowerCase()} work</h2>{rows.length === 0 && <p>No matching work.</p>}
    {rows.map((row) => {
      const data = Object.fromEntries(Object.entries(row).filter(([, value]) => typeof value === "string")) as Record<string, string>;
      const deadline = { deadlineKind: row.deadlineKind, dueDate: row.dueDate ? literalDate(row.dueDate) : undefined, dueAt: row.dueAt?.toISOString(), dueTimezone: row.dueTimezone ?? undefined };
      return <section key={`${row.kind}-${row.id}`}><h2>{row.title}</h2><p>{row.kind} · {row.status} · {row.priority}{row.archivedAt && " · Archived"}</p><p>{row.description}</p><p>{row.deadlineKind === "NONE" ? "No deadline" : row.dueDate ? `Due ${literalDate(row.dueDate)} · ${row.dueTimezone}` : `Due ${row.dueAt!.toISOString()} · ${row.dueTimezone}`}</p>
        {row.kind === "PROJECT" && <p><Link href={`/work?project=${row.id}`}>View active project work</Link> · <Link href={`/work?view=MANAGEMENT&project=${row.id}`}>View project history</Link></p>}
        <details><summary>Edit work and context</summary><form action={updateWorkAction}>{identity(row.kind, row.id)}<WorkFields kind={row.kind} choices={choices} data={data} /><Submit>Save work</Submit></form></details>
        <form action={workLifecycleAction}>{identity(row.kind, row.id)}<label>Lifecycle<select name="status" defaultValue={row.status}>{states[row.kind].map((value) => <option key={value}>{value}</option>)}</select></label><Submit>Change lifecycle</Submit></form>
        {(row.kind === "PROJECT" || !activeStatus(row.kind, row.status) || row.archivedAt) && <form action={archiveWorkAction}>{identity(row.kind, row.id)}<Hidden name="archived" value={row.archivedAt ? "false" : "true"} /><Submit>{row.archivedAt ? "Restore work" : "Archive work"}</Submit></form>}
        <details><summary>{row.deadlineKind === "NONE" ? "Add deadline" : "Edit deadline"}</summary><form action={deadlineAction}>{identity(row.kind, row.id)}<Hidden name="operation" value={row.deadlineKind === "NONE" ? "CREATE" : "UPDATE"} /><DeadlineFields timezone={profile.timezone} allowNone={false} data={row.deadlineKind === "NONE" ? { deadlineKind: "DATE_ONLY" } : deadline} /><Submit>Save deadline</Submit></form>{row.deadlineKind !== "NONE" && <form action={deadlineAction}>{identity(row.kind, row.id)}<Hidden name="operation" value="REMOVE" /><Submit>Remove deadline</Submit></form>}</details>
      </section>;
    })}
  </AcademicShell>;
}
