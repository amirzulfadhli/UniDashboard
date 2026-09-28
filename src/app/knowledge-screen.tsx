import Link from "next/link";
import { notFound } from "next/navigation";
import { AcademicError } from "../academic/errors";
import { getPrisma } from "../auth/db";
import { queryKnowledge, knowledgeOptions } from "../knowledge/queries";
import { ownedKnowledge } from "../knowledge/service";
import { NoteContent, ResourceLink } from "../knowledge/presentation";
import type { KnowledgeKind } from "../knowledge/validation";
import { AcademicShell, Field, Hidden, Submit } from "./academic-ui";
import { requirePageUser } from "./protected-user";
import { archiveKnowledgeAction, createKnowledgeAction, updateKnowledgeAction, updateNoteContentAction } from "./knowledge-actions";
import { NoteEditForms } from "./note-edit-forms";
type Search = { view?: string; course?: string; id?: string; error?: string };
export async function KnowledgeScreen({ kind, search }: { kind: KnowledgeKind; search: Search }) {
  const owner = await requirePageUser(), prisma = getPrisma();
  const destination = kind === "NOTE" ? "/notes" : "/resources", view = search.view ?? "ACTIVE";
  let rows, courses;
  try {
    rows = search.id ? [await ownedKnowledge(prisma, owner, kind, search.id)] : await queryKnowledge(prisma, owner, kind, { view, courseId: search.course === "standalone" ? null : search.course || undefined, includeArchived: view === "MANAGEMENT" });
    courses = await knowledgeOptions(prisma, owner);
  } catch (error) { if (error instanceof AcademicError) notFound(); throw error; }
  const identity = (id?: string) => <><Hidden name="kind" value={kind} />{id && <Hidden name="id" value={id} />}</>;
  const fields = (record?: typeof rows[number]) => <><Field name="title" label="Title" value={record?.title} />
    <label>Course<select name="courseId" defaultValue={record?.courseId ?? ""}><option value="">Standalone</option>{courses.map((course) => {
      const eligible = !course.archivedAt && ["UPCOMING", "ACTIVE"].includes(course.status) && !course.term.archivedAt && ["PLANNED", "ACTIVE"].includes(course.term.status);
      return <option key={course.id} value={course.id} disabled={!eligible && record?.courseId !== course.id}>{course.courseCode} · {course.title}{!eligible && " (historical)"}</option>;
    })}</select></label>
    {kind === "NOTE" ? <><label>Content<textarea name="contentMarkdown" rows={8} defaultValue={record && "contentMarkdown" in record ? record.contentMarkdown : ""} /></label><label>Pinned<select name="pinned" defaultValue={record && "pinned" in record && record.pinned ? "true" : "false"}><option value="false">No</option><option value="true">Yes</option></select></label></> : <><Field name="url" label="Resource URL (HTTP or HTTPS)" value={record && "url" in record ? record.url : ""} /><Field name="description" label="Description (optional)" required={false} value={record && "description" in record ? record.description ?? "" : ""} /></>}
  </>;
  return <AcademicShell title={kind === "NOTE" ? "Notes" : "Resources"} error={search.error}>
    <nav className="flex gap-4" aria-label="Knowledge views"><Link href={destination}>Active</Link><Link href={`${destination}?view=MANAGEMENT`}>Management / history</Link><Link href={kind === "NOTE" ? "/resources" : "/notes"}>{kind === "NOTE" ? "Resources" : "Notes"}</Link></nav>
    <form method="get"><label>View<select name="view" defaultValue={view}><option>ACTIVE</option><option>MANAGEMENT</option></select></label><label>Course filter<select name="course" defaultValue={search.course ?? ""}><option value="">All personal knowledge</option><option value="standalone">Standalone only</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.courseCode} · {course.title}</option>)}</select></label><Submit>Filter</Submit></form>
    <section><details><summary>Create {kind.toLowerCase()}</summary><form action={createKnowledgeAction}>{identity()}{fields()}<Submit>Create {kind.toLowerCase()}</Submit></form></details></section>
    {rows.length === 0 && <p>No matching {kind === "NOTE" ? "notes" : "resources"}.</p>}
    {rows.map((record) => <section key={record.id}><h2><Link href={`${destination}?id=${record.id}`}>{record.title}</Link></h2><p>{record.archivedAt ? "Archived" : "Active"}{"pinned" in record && record.pinned && " · Pinned"} · {record.courseId ? courses.find((course) => course.id === record.courseId)?.courseCode : "Standalone"}</p>
      {"contentMarkdown" in record ? <NoteContent content={record.contentMarkdown} /> : <><ResourceLink url={record.url} title={`Open ${record.title}`} /><p>{record.description}</p></>}
      {"contentMarkdown" in record ? <NoteEditForms note={record} courses={courses.map((course) => {
        const eligible = !course.archivedAt && ["UPCOMING", "ACTIVE"].includes(course.status) && !course.term.archivedAt && ["PLANNED", "ACTIVE"].includes(course.term.status);
        return { id: course.id, label: `${course.courseCode} · ${course.title}${eligible ? "" : " (historical)"}`, disabled: !eligible && record.courseId !== course.id };
      })} metadataAction={updateKnowledgeAction} contentAction={updateNoteContentAction} />
        : <details><summary>Edit resource</summary><form action={updateKnowledgeAction}>{identity(record.id)}{fields(record)}<Submit>Save resource</Submit></form></details>}
      <form action={archiveKnowledgeAction}>{identity(record.id)}<Hidden name="archived" value={record.archivedAt ? "false" : "true"} /><Submit>{record.archivedAt ? "Restore" : "Archive"} {kind.toLowerCase()}</Submit></form>
    </section>)}
  </AcademicShell>;
}
