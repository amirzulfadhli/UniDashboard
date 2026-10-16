import Link from "next/link";
import { redirect } from "next/navigation";
import { AcademicError } from "../../academic/errors";
import { getPrisma } from "../../auth/db";
import { getTomorrowAgenda, getUpcomingAgenda, getWeekAgenda } from "../../agenda/queries";
import { happeningNow, isTimedWork, nextTimedItem } from "../../agenda/temporal";
import type { AgendaDay, AgendaItem } from "../../agenda/types";
import { AcademicShell, Submit } from "../academic-ui";
import { requirePageUser } from "../protected-user";

type Search = { view?: string; startDate?: string; endDate?: string; term?: string; ownerId?: string; userId?: string; authUserId?: string; course?: string; project?: string };
function AgendaCard({ item }: { item: AgendaItem }) {
  if (item.kind === "CLASS") return <article className="my-2 rounded border border-slate-200 p-3">
    <h3>{item.course.code} · {item.title}</h3>
    <p>{item.viewerStartDate} {item.viewerStartTime} → {item.viewerEndDate} {item.viewerEndTime} · {item.position}</p>
    <p>Class · {item.occurrenceState} · {item.effectiveTimezone} · {item.location ?? "No location"}</p>
  </article>;
  const context = [item.course?.code, item.project?.title, item.assignment?.title].filter(Boolean).join(" · ");
  if (item.deadline.kind === "DATE_ONLY") return <article className="my-2 rounded border border-slate-200 p-3">
    <h3>{item.title}</h3><p>All day · {item.kind} · {item.deadline.date} · {item.deadline.classification}</p>
    <p>{item.deadline.timezone} · {item.lifecycle}{context && ` · ${context}`}</p>
  </article>;
  if (!isTimedWork(item)) return null;
  return <article className="my-2 rounded border border-slate-200 p-3">
    <h3>{item.title}</h3><p>{item.viewerTime} · {item.kind} · {item.position}{item.deadline.dueToday && " · Due today"}{item.deadline.overdue && " · Overdue"}</p>
    <p>Deadline zone {item.deadline.timezone} · {item.lifecycle}{context && ` · ${context}`}</p>
  </article>;
}
function Day({ day }: { day: AgendaDay }) {
  return <section className="my-5"><h2 className="text-xl font-semibold">{day.date}</h2>
    {day.items.length ? day.items.map((item) => <AgendaCard key={`${item.kind}:${item.kind === "CLASS" ? `${item.identity.scheduleId}:${item.identity.originalDate}` : item.identity.workId}`} item={item} />) : <p>No classes or deadlines.</p>}
  </section>;
}
export default async function AgendaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const owner = await requirePageUser(), search = await searchParams, now = new Date();
  const view = search.view ?? "TODAY";
  let agenda;
  try {
    if ([search.ownerId, search.userId, search.authUserId, search.course, search.project].some((value) => value !== undefined)) throw new AcademicError("INVALID_INPUT", "Use an owned Term context for Agenda.");
    const options = { now, ...(search.term === undefined ? {} : { termId: search.term }) };
    const prisma = getPrisma();
    if (view === "TODAY") agenda = await getUpcomingAgenda(prisma, owner, undefined, undefined, options);
    else if (view === "TOMORROW") agenda = await getTomorrowAgenda(prisma, owner, options);
    else if (view === "WEEK") agenda = await getWeekAgenda(prisma, owner, options);
    else if (view === "UPCOMING") agenda = await getUpcomingAgenda(prisma, owner, search.startDate, search.endDate, options);
    else throw new AcademicError("INVALID_INPUT", "Choose a valid agenda view.");
  } catch (error) {
    if (error instanceof AcademicError && error.code === "INVALID_STATE") redirect("/onboarding");
    if (error instanceof AcademicError) return <AcademicShell title="Agenda" error={error.message}><Link href="/agenda">Open today</Link></AcademicShell>;
    throw error;
  }
  const shown = view === "TODAY" ? agenda.days.slice(0, 1) : agenda.days;
  const current = view === "TODAY" ? happeningNow(agenda, now) : [];
  const next = view === "TODAY" ? nextTimedItem(agenda, now) : null;
  return <AcademicShell title="Agenda">
    <nav className="flex flex-wrap gap-4" aria-label="Agenda views"><Link href="/agenda">Today</Link><Link href="/agenda?view=TOMORROW">Tomorrow</Link><Link href="/agenda?view=WEEK">This Week</Link><Link href="/agenda?view=UPCOMING">Upcoming</Link></nav>
    <p>Viewer timezone: {agenda.viewerTimezone}. Classes use your selected Term. Date-only deadlines have no clock time.</p>
    {view === "UPCOMING" && <form method="get"><input type="hidden" name="view" value="UPCOMING" /><label>From<input name="startDate" type="date" defaultValue={agenda.startDate} required /></label><label>Through<input name="endDate" type="date" defaultValue={agenda.endDate} required /></label><Submit>View range</Submit></form>}
    {view === "TODAY" && <section className="my-5"><h2 className="text-xl font-semibold">Happening now</h2>{current.length ? current.map((item) => <p key={`${item.identity.scheduleId}:${item.identity.originalDate}`}>{item.course.code} · {item.viewerStartTime}–{item.viewerEndTime}</p>) : <p>No class is happening now.</p>}
      <h2 className="mt-4 text-xl font-semibold">Next timed item within 30 days</h2>{next ? <p>{next.kind === "CLASS" ? next.course.code : next.title} · {next.kind === "CLASS" ? `${next.viewerStartDate} ${next.viewerStartTime}` : `${next.viewerDate} ${next.viewerTime}`}</p> : <p>No timed item in this range.</p>}
    </section>}
    {shown.map((day) => <Day key={day.date} day={day} />)}
  </AcademicShell>;
}
