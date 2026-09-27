import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrisma } from "../../auth/db";
import { AcademicError } from "../../academic/errors";
import { listCourses, listTerms, ownedTerm } from "../../academic/records";
import { listSchedules, seriesFromRow } from "../../academic/schedules";
import { selectedAcademicContext } from "../../academic/queries";
import { literalDate } from "../../academic/validation";
import { requirePageUser } from "../protected-user";
import { AcademicShell, Field, Hidden, ScheduleFields, Submit } from "../academic-ui";
import { archiveCourseAction, courseLifecycleAction, createCourseAction, createScheduleAction, retireScheduleAction, splitScheduleAction, updateCourseAction } from "../academic-actions";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ term?: string; error?: string }> }) {
  const owner = await requirePageUser();
  const prisma = getPrisma();
  const search = await searchParams;
  const context = await selectedAcademicContext(prisma, owner);
  let term = context.term;
  if (search.term) {
    try { term = await ownedTerm(prisma, owner, search.term); } catch (error) { if (error instanceof AcademicError) notFound(); throw error; }
  }
  const terms = await listTerms(prisma, owner, true);
  const courses = term ? await listCourses(prisma, owner, term.id, true) : [];
  return <AcademicShell title="Courses" error={search.error}><nav aria-label="Term choices">{terms.map((choice) => <Link className="mr-4" key={choice.id} href={`/courses?term=${choice.id}`}>{choice.name}{choice.archivedAt ? " (archived)" : ""}</Link>)}</nav>
    {!term ? <p className="mt-4">Select a term on the Terms page.</p> : <><h2 className="mt-6">{term.name}</h2>{!term.archivedAt && <section><h2>Create course</h2><form action={createCourseAction}><Hidden name="termId" value={term.id} /><Field name="courseCode" label="Course code" /><Field name="title" label="Title" /><Field name="description" label="Description (optional)" required={false} /><Submit>Create course</Submit></form></section>}
      {await Promise.all(courses.map(async (course) => {
        const schedules = await listSchedules(prisma, owner, course.id);
        return <section key={course.id}><h2>{course.courseCode} · {course.title}</h2><p>{course.status}{course.archivedAt && " · Archived"}{course.firstDependantAt && " · Term locked"}</p>
          <form action={courseLifecycleAction}><Hidden name="id" value={course.id} /><label>Lifecycle<select name="status" defaultValue={course.status}>{["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select></label><Submit>Change lifecycle</Submit></form>
          <form action={archiveCourseAction}><Hidden name="id" value={course.id} /><Hidden name="archived" value={course.archivedAt ? "false" : "true"} /><Submit>{course.archivedAt ? "Restore course" : "Archive course"}</Submit></form>
          <details><summary>Edit course metadata</summary><form action={updateCourseAction}><Hidden name="id" value={course.id} /><label>Term<select name="termId" defaultValue={course.termId}>{terms.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label><Field name="courseCode" label="Course code" value={course.courseCode} /><Field name="title" label="Title" value={course.title} /><Field name="description" label="Description (optional)" value={course.description ?? ""} required={false} /><Submit>Save course</Submit></form></details>
          {!course.archivedAt && !term!.archivedAt && (course.status === "UPCOMING" || course.status === "ACTIVE") && <details><summary>Add recurring class</summary><form action={createScheduleAction}><Hidden name="courseId" value={course.id} /><ScheduleFields data={{ timezone: term!.academicTimezone, originalStartDate: literalDate(term!.teachingStartsOn), originalEndDate: literalDate(term!.endsOn) }} /><Submit>Add class</Submit></form></details>}
          {schedules.map((row) => {
            const series = seriesFromRow(row);
            const successor = schedules.some((candidate) => candidate.predecessorId === row.id);
            return <div className="my-4 border-t border-slate-200 pt-4" key={row.id}><p>Weekday {series.weekday} · {series.localStartTime}–{series.localEndTime}{series.endDayOffset ? " (+1 day)" : ""} · {series.timezone} · {series.location ?? "No location"}</p><p>{series.originalStartDate}–{series.originalEndDate}{series.retiredFromDate && ` · Retired from ${series.retiredFromDate}`}{row.predecessorId && " · Successor series"}</p>
              {!successor && <><details><summary>Change this and future</summary><p>Choose an original occurrence date. The successor starts on that date. Past recurrence stays unchanged; exceptions at and after the boundary are discarded.</p><form action={splitScheduleAction}><Hidden name="scheduleId" value={row.id} /><Hidden name="courseId" value={course.id} /><Field name="originalDate" label="Original split occurrence date" type="date" /><ScheduleFields split data={{ ...series, weekday: String(series.weekday), endDayOffset: String(series.endDayOffset), location: series.location ?? "" }} /><Submit>Split this and future</Submit></form></details>
                <details><summary>Retire future classes</summary><form action={retireScheduleAction}><Hidden name="scheduleId" value={row.id} /><Field name="originalDate" label="First excluded original occurrence date" type="date" /><Submit>Retire series</Submit></form></details></>}
            </div>;
          })}
        </section>;
      }))}</>}
  </AcademicShell>;
}
