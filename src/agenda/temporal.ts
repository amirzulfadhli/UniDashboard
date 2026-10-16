import { Temporal } from "@js-temporal/polyfill";
import { invalid } from "../academic/errors";
import { academicDate, localDayRange } from "../academic/recurrence";
import { weekStart } from "../academic/schedules";
import { dateInput, zoneInput } from "../academic/validation";
import type { AgendaDay, AgendaItem, AgendaResult, ClassAgendaItem, TimedAgendaItem } from "./types";

export function viewerStamp(instant: Date, timezone: string) {
  const local = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(timezone);
  return { date: local.toPlainDate().toString(), time: local.toPlainTime().toString().slice(0, 5) };
}
export function viewerToday(now: Date, timezone: string) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) invalid("Choose a valid current instant.");
  return academicDate(now, zoneInput(timezone));
}
export function tomorrowDate(now: Date, timezone: string) {
  return Temporal.PlainDate.from(viewerToday(now, timezone)).add({ days: 1 }).toString();
}
export function weekDates(now: Date, timezone: string) {
  const startDate = weekStart(viewerToday(now, timezone));
  return { startDate, endDate: Temporal.PlainDate.from(startDate).add({ days: 6 }).toString() };
}
export function viewerWindow(startInput: unknown, endInput: unknown, timezone: string) {
  const startDate = dateInput(startInput), endDate = dateInput(endInput), zone = zoneInput(timezone);
  const first = Temporal.PlainDate.from(startDate), last = Temporal.PlainDate.from(endDate);
  const span = first.until(last).days;
  if (span < 0 || span > 365) invalid("Choose an inclusive agenda range of at most 366 calendar days.");
  let after: Temporal.PlainDate;
  try { after = last.add({ days: 1 }); } catch { return invalid("Choose an agenda date before the last supported day."); }
  const start = localDayRange(startDate, zone).start, end = localDayRange(after.toString(), zone).start;
  if (end <= start) invalid("Choose a positive agenda interval.");
  const days: AgendaDay[] = [];
  for (let day = first; Temporal.PlainDate.compare(day, last) <= 0; day = day.add({ days: 1 })) {
    const date = day.toString(), range = localDayRange(date, zone);
    days.push({ date, startAt: range.start, endAt: range.end, items: [] });
  }
  return { startDate, endDate, start, end, days };
}
export function agendaIdentity(item: AgendaItem) {
  return item.kind === "CLASS" ? `${item.identity.scheduleId}:${item.identity.originalDate}` : item.identity.workId;
}
export const classPosition = (start: Date, end: Date, now: Date) => end <= now ? "PAST" as const : start <= now ? "CURRENT" as const : "UPCOMING" as const;
export const pointPosition = (at: Date, now: Date) => at < now ? "PAST" as const : "UPCOMING" as const;
export function compareAgendaItems(a: AgendaItem, b: AgendaItem, dayStart: Date) {
  const rank = (item: AgendaItem) => item.kind === "CLASS" && item.startsAt < dayStart ? 0 : item.kind !== "CLASS" && item.deadline.kind === "DATE_ONLY" ? 2 : 1;
  const aRank = rank(a), bRank = rank(b);
  if (aRank !== bRank) return aRank - bRank;
  const moment = (item: AgendaItem) => item.kind === "CLASS" ? item.startsAt.getTime() : item.deadline.kind === "TIMED" ? item.deadline.at.getTime() : 0;
  return (aRank === 2 ? 0 : moment(a) - moment(b)) || a.kind.localeCompare(b.kind) || agendaIdentity(a).localeCompare(agendaIdentity(b));
}
export function happeningNow(agenda: AgendaResult, now: Date): ClassAgendaItem[] {
  const found = new Map<string, ClassAgendaItem>();
  for (const day of agenda.days) for (const item of day.items) if (item.kind === "CLASS" && item.startsAt <= now && item.endsAt > now) found.set(agendaIdentity(item), item);
  return [...found.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || agendaIdentity(a).localeCompare(agendaIdentity(b)));
}
export const isTimedWork = (item: AgendaItem): item is TimedAgendaItem => item.kind !== "CLASS" && item.deadline.kind === "TIMED";
export function nextTimedItem(agenda: AgendaResult, now: Date): ClassAgendaItem | TimedAgendaItem | null {
  const found = new Map<string, ClassAgendaItem | TimedAgendaItem>();
  for (const day of agenda.days) for (const item of day.items) {
    if (item.kind === "CLASS") {
      if (item.startsAt >= now) found.set(`${item.kind}:${agendaIdentity(item)}`, item);
    } else if (isTimedWork(item) && item.deadline.at >= now) {
      found.set(`${item.kind}:${agendaIdentity(item)}`, item);
    }
  }
  return [...found.values()].sort((a, b) => {
    const instant = (item: ClassAgendaItem | TimedAgendaItem) => item.kind === "CLASS" ? item.startsAt.getTime() : item.deadline.at.getTime();
    return instant(a) - instant(b) || a.kind.localeCompare(b.kind) || agendaIdentity(a).localeCompare(agendaIdentity(b));
  })[0] ?? null;
}
