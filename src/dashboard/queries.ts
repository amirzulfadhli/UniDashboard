import { Temporal } from "@js-temporal/polyfill";
import type { PrismaClient } from "../generated/prisma/client";
import { invalid } from "../academic/errors";
import type { AcademicOwner } from "../academic/records";
import { academicDate } from "../academic/recurrence";
import { loadTimetableCandidates } from "../academic/queries";
import { idInput, literalDate } from "../academic/validation";
import { projectAgenda } from "../agenda/queries";
import { agendaIdentity, happeningNow, viewerStamp, viewerToday, viewerWindow } from "../agenda/temporal";
import type { ClassAgendaItem } from "../agenda/types";
import { getOnboardingState } from "../onboarding/service";
import { deadlineFacts, loadActiveWorkSummary } from "../work/queries";

type WorkRow = Awaited<ReturnType<typeof loadActiveWorkSummary>>[number];
const priorityRank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function dashboardWork(row: WorkRow, now: Date, timezone: string) {
  const facts = deadlineFacts(row, now);
  const local = row.dueAt ? viewerStamp(row.dueAt, timezone) : null;
  return {
    id: row.id, kind: row.kind, title: row.title, status: row.status, priority: row.priority,
    deadline: !facts ? null : {
      kind: row.deadlineKind, date: row.dueDate ? literalDate(row.dueDate) : local!.date,
      time: local?.time ?? null, timezone: row.dueTimezone!, sourceDate: facts.sourceDueDate,
      at: row.deadlineKind === "TIMED" ? row.dueAt : null,
      overdue: facts.overdue, dueToday: facts.dueToday,
    },
  };
}
export type DashboardWork = ReturnType<typeof dashboardWork>;
const attentionRank = (item: DashboardWork) => item.deadline?.overdue ? 0 : item.deadline?.dueToday ? 1 : 2;
const deadlineOrder = (a: DashboardWork, b: DashboardWork) =>
  (a.deadline?.date ?? "9999-12-31").localeCompare(b.deadline?.date ?? "9999-12-31")
  || (a.deadline?.at && b.deadline?.at ? +a.deadline.at - +b.deadline.at : 0)
  || (a.deadline?.time ?? "").localeCompare(b.deadline?.time ?? "")
  || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);

/** No invented instant for an all-day deadline; priority follows source-zone urgency. */
export function comparePriorityTasks(a: DashboardWork, b: DashboardWork) {
  return attentionRank(a) - attentionRank(b) || priorityRank[a.priority] - priorityRank[b.priority]
    || Number(b.status === "IN_PROGRESS") - Number(a.status === "IN_PROGRESS") || deadlineOrder(a, b);
}

export async function getDashboard(prisma: PrismaClient, owner: AcademicOwner, now = new Date()) {
  idInput(owner.id);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) invalid("Choose a valid current instant.");
  const snapshot = await prisma.$transaction(async (tx) => {
    const state = await getOnboardingState(tx, owner);
    if (!state.profile || !state.firstTerm) return { ready: false as const, destination: "/onboarding" };
    if (!state.selectedTerm || state.selectedTerm.archivedAt) return { ready: false as const, destination: "/terms" };
    const { profile, selectedTerm: term } = state;
    // Reuse domain loaders in this same snapshot; never call a transaction per card.
    const today = viewerToday(now, profile.timezone);
    const window = viewerWindow(today, Temporal.PlainDate.from(today).add({ days: 30 }).toString(), profile.timezone);
    const academic = await loadTimetableCandidates(tx, owner, term.id, window.start, window.end);
    // Dashboard uses Agenda's class projection; work deadlines are loaded once below.
    const agendaSnapshot = { viewerTimezone: profile.timezone, window, academic, work: { tasks: [], projects: [], assignments: [] } };
    const work = await loadActiveWorkSummary(tx, owner);
    const courses = await tx.course.findMany({ where: { ownerId: owner.id, termId: term.id, archivedAt: null, status: { in: ["UPCOMING", "ACTIVE"] } },
      select: { id: true, courseCode: true, title: true, status: true }, orderBy: [{ courseCode: "asc" }, { id: "asc" }] });
    const identity = await tx.authUser.findUnique({ where: { domainUserId: owner.id }, select: { email: true } });
    return { ready: true as const, profile, term, agendaSnapshot, work, courses, identity, programme: state.programme };
  }, { isolationLevel: "RepeatableRead" });
  if (!snapshot.ready) return snapshot;
  const { profile, term, courses, identity } = snapshot;
  const active = snapshot.work.map((row) => dashboardWork(row, now, profile.timezone));
  const agenda = projectAgenda(snapshot.agendaSnapshot, now);
  const classes = [...new Map(agenda.days.flatMap((day) => day.items)
    .filter((item): item is ClassAgendaItem => item.kind === "CLASS")
    .map((item) => [agendaIdentity(item), item])).values()];
  const todayClasses = agenda.days[0]!.items.filter((item): item is ClassAgendaItem => item.kind === "CLASS");
  const nextClass = classes.filter((item) => item.startsAt >= now)
    .sort((a, b) => +a.startsAt - +b.startsAt || agendaIdentity(a).localeCompare(agendaIdentity(b)))[0] ?? null;
  const deadlines = active.filter((item) => item.deadline && (item.deadline.overdue || item.deadline.dueToday || item.deadline.date <= agenda.endDate))
    .sort((a, b) => attentionRank(a) - attentionRank(b) || deadlineOrder(a, b));
  const tasks = active.filter((item) => item.kind === "TASK").sort(comparePriorityTasks);
  const academicToday = academicDate(now, term.academicTimezone);
  const teachingStart = literalDate(term.teachingStartsOn), termEnd = literalDate(term.endsOn);
  const teachingWeek = academicToday < teachingStart || academicToday > termEnd ? null
    : Math.floor(Temporal.PlainDate.from(teachingStart).until(Temporal.PlainDate.from(academicToday)).days / 7) + 1;
  return {
    ready: true as const, now, today: agenda.startDate, horizonEnd: agenda.endDate,
    timezone: profile.timezone, displayName: profile.displayName, email: identity?.email ?? null,
    programme: snapshot.programme?.name ?? null,
    term: { id: term.id, name: term.name, status: term.status, timezone: term.academicTimezone,
      startsOn: literalDate(term.startsOn), endsOn: termEnd, teachingStartsOn: teachingStart, teachingWeek },
    courses: courses.slice(0, 4), courseCount: courses.length,
    todayClasses, currentClasses: happeningNow(agenda, now), nextClass,
    deadlines: deadlines.slice(0, 6), deadlineCount: deadlines.length,
    tasks: tasks.slice(0, 5), taskCount: tasks.length,
    dueTodayCount: active.filter((item) => item.deadline?.dueToday).length,
    overdueCount: active.filter((item) => item.deadline?.overdue).length,
  };
}
export type Dashboard = Extract<Awaited<ReturnType<typeof getDashboard>>, { ready: true }>;
