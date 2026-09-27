import Link from "next/link";
import { Temporal } from "@js-temporal/polyfill";
import { getPrisma } from "../../auth/db";
import { selectedAcademicContext, timetableRange, nextClass, todaysClasses, type TimetableOccurrence } from "../../academic/queries";
import { AcademicError } from "../../academic/errors";
import { dateInput } from "../../academic/validation";
import { localDayRange } from "../../academic/recurrence";
import { weekStart } from "../../academic/schedules";
import { requirePageUser } from "../protected-user";
import { AcademicShell, Field, Hidden, Submit } from "../academic-ui";
import { exceptionAction, removeExceptionAction } from "../academic-actions";

function stamp(instant: Date, zone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}
function OccurrenceCard({ occurrence, week }: { occurrence: TimetableOccurrence; week: string }) {
  const start = Temporal.Instant.fromEpochMilliseconds(occurrence.startsAt.getTime()).toZonedDateTimeISO(occurrence.timezone);
  const end = Temporal.Instant.fromEpochMilliseconds(occurrence.endsAt.getTime()).toZonedDateTimeISO(occurrence.timezone);
  return <article className="my-3 rounded border border-slate-200 bg-white p-3"><h3>{occurrence.courseCode} · {occurrence.courseTitle}</h3>
    <p className={occurrence.state === "CANCELLED" ? "line-through" : ""}>{stamp(occurrence.startsAt, occurrence.timezone)} → {stamp(occurrence.endsAt, occurrence.timezone)}</p>
    <p>{occurrence.timezone} · {occurrence.location ?? "No location"}{occurrence.state !== "NORMAL" && ` · ${occurrence.state}`}</p>
    <details><summary>This occurrence · original date {occurrence.originalDate}</summary>
      {occurrence.state !== "CANCELLED" && <form action={exceptionAction}><Hidden name="returnWeek" value={week} /><Hidden name="scheduleId" value={occurrence.scheduleId} /><Hidden name="originalDate" value={occurrence.originalDate} /><Hidden name="kind" value="CANCEL" /><Submit>Cancel this occurrence</Submit></form>}
      {occurrence.state !== "NORMAL" && <form action={removeExceptionAction}><Hidden name="returnWeek" value={week} /><Hidden name="scheduleId" value={occurrence.scheduleId} /><Hidden name="originalDate" value={occurrence.originalDate} /><Submit>Restore original occurrence</Submit></form>}
      <form action={exceptionAction}><Hidden name="returnWeek" value={week} /><Hidden name="scheduleId" value={occurrence.scheduleId} /><Hidden name="originalDate" value={occurrence.originalDate} /><Hidden name="kind" value="MOVE" />
        <Field name="replacementStartDate" label="Move start date" type="date" value={start.toPlainDate().toString()} /><Field name="replacementStartTime" label="Move local start time" type="time" value={start.toPlainTime().toString()} />
        <Field name="replacementEndDate" label="Move end date" type="date" value={end.toPlainDate().toString()} /><Field name="replacementEndTime" label="Move local end time" type="time" value={end.toPlainTime().toString()} />
        <Field name="replacementTimezone" label="Move timezone (IANA)" value={occurrence.timezone} /><Field name="replacementLocation" label="Move location (optional)" value={occurrence.location ?? ""} required={false} /><Submit>Move this occurrence</Submit>
      </form><Link href="/courses">Change this and future from the course schedule</Link>
    </details></article>;
}
export default async function TimetablePage({ searchParams }: { searchParams: Promise<{ week?: string; error?: string }> }) {
  const owner = await requirePageUser();
  const prisma = getPrisma();
  const context = await selectedAcademicContext(prisma, owner);
  const search = await searchParams;
  if (!context.term) return <AcademicShell title="Timetable" error={search.error}><p>Select a non-archived <Link href="/terms">term</Link> to view classes.</p></AcademicShell>;
  let monday = weekStart(context.today);
  let error = search.error;
  try { if (search.week) monday = weekStart(dateInput(search.week)); } catch (caught) { if (caught instanceof AcademicError) error = caught.message; else throw caught; }
  const day = Temporal.PlainDate.from(monday);
  const timezone = context.term.academicTimezone;
  const start = localDayRange(monday, timezone).start;
  const end = localDayRange(day.add({ days: 7 }).toString(), timezone).start;
  const [occurrences, today, next] = await Promise.all([timetableRange(prisma, owner, start, end, undefined, true), todaysClasses(prisma, owner, context.today, timezone), nextClass(prisma, owner)]);
  return <AcademicShell title={`Timetable · ${context.term.name}`} error={error}><p>Week of {monday} · day grouping in {timezone}</p>
    <nav className="my-4 flex gap-4" aria-label="Week navigation"><Link href={`/timetable?week=${day.subtract({ days: 7 })}`}>Previous week</Link><Link href="/timetable">This week</Link><Link href={`/timetable?week=${day.add({ days: 7 })}`}>Next week</Link></nav>
    <form method="get"><Field name="week" label="Jump to week containing" type="date" value={monday} /><Submit>View week</Submit></form>
    <section><h2>Today · {context.today}</h2>{today.length ? today.map((occurrence) => <p key={`${occurrence.scheduleId}:${occurrence.originalDate}`}>{occurrence.courseCode} · {stamp(occurrence.startsAt, occurrence.timezone)} · {occurrence.location ?? "No location"}</p>) : <p>No active classes today.</p>}<h2 className="mt-4">Next class</h2>{next ? <p>{next.courseCode} · {stamp(next.startsAt, next.timezone)} · {next.timezone}</p> : <p>No upcoming class.</p>}</section>
    {Array.from({ length: 7 }, (_, offset) => {
      const date = day.add({ days: offset }).toString();
      const range = localDayRange(date, timezone);
      const onDay = occurrences.filter((occurrence) => occurrence.startsAt < range.end && occurrence.endsAt > range.start);
      return <section key={date}><h2>{new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long" }).format(range.start)} · {date}</h2>
        {onDay.filter((occurrence) => occurrence.state !== "CANCELLED").map((occurrence) => <OccurrenceCard key={`${occurrence.scheduleId}:${occurrence.originalDate}`} occurrence={occurrence} week={monday} />)}
        {!onDay.some((occurrence) => occurrence.state !== "CANCELLED") && <p>No active classes.</p>}
        {onDay.some((occurrence) => occurrence.state === "CANCELLED") && <details><summary>Cancelled occurrences</summary>{onDay.filter((occurrence) => occurrence.state === "CANCELLED").map((occurrence) => <OccurrenceCard key={`${occurrence.scheduleId}:${occurrence.originalDate}`} occurrence={occurrence} week={monday} />)}</details>}
      </section>;
    })}
  </AcademicShell>;
}
