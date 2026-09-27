import { Temporal } from "@js-temporal/polyfill";

export type Series = Readonly<{
  id: string; courseId: string; weekday: number; localStartTime: string; localEndTime: string;
  endDayOffset: number; timezone: string; originalStartDate: string; originalEndDate: string;
  retiredFromDate: string | null; location: string | null;
}>;
export type OccurrenceException = Readonly<{
  originalDate: string; kind: "CANCEL" | "MOVE"; replacementStartsAt: Date | null;
  replacementEndsAt: Date | null; replacementTimezone: string | null; replacementLocation: string | null;
}>;
export type ClassOccurrence = Readonly<{
  scheduleId: string; courseId: string; originalDate: string; startsAt: Date; endsAt: Date;
  timezone: string; location: string | null; state: "NORMAL" | "CANCELLED" | "MOVED";
}>;

/** Earlier overlap instant; a nonexistent local clock time has no occurrence. */
export function localInstant(date: string, time: string, zone: string): Date | null {
  const local = Temporal.PlainDateTime.from(`${date}T${time}`);
  const zoned = local.toZonedDateTime(zone, { disambiguation: "earlier" });
  if (!zoned.toPlainDateTime().equals(local)) return null;
  return new Date(zoned.epochMilliseconds);
}
export function academicDate(instant: Date, timezone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(timezone).toPlainDate().toString();
}
export function originalOccurrence(series: Series, date: string): ClassOccurrence | null {
  const day = Temporal.PlainDate.from(date);
  if (day.dayOfWeek !== series.weekday || date < series.originalStartDate || date > series.originalEndDate || (series.retiredFromDate && date >= series.retiredFromDate)) return null;
  const startsAt = localInstant(date, series.localStartTime, series.timezone);
  const endsAt = localInstant(day.add({ days: series.endDayOffset }).toString(), series.localEndTime, series.timezone);
  if (!startsAt || !endsAt || endsAt <= startsAt) return null;
  return { scheduleId: series.id, courseId: series.courseId, originalDate: date, startsAt, endsAt,
    timezone: series.timezone, location: series.location, state: "NORMAL" };
}
function applyException(original: ClassOccurrence, exception?: OccurrenceException): ClassOccurrence {
  if (!exception) return original;
  if (exception.kind === "CANCEL") return { ...original, state: "CANCELLED" };
  return { ...original, startsAt: exception.replacementStartsAt!, endsAt: exception.replacementEndsAt!,
    timezone: exception.replacementTimezone!, location: exception.replacementLocation, state: "MOVED" };
}
export const compareOccurrences = (a: ClassOccurrence, b: ClassOccurrence) => a.startsAt.getTime() - b.startsAt.getTime()
  || a.endsAt.getTime() - b.endsAt.getTime() || a.scheduleId.localeCompare(b.scheduleId) || a.originalDate.localeCompare(b.originalDate);
export const overlaps = (occurrence: ClassOccurrence, start: Date, end: Date) => occurrence.startsAt < end && occurrence.endsAt > start;

/** Half-open effective instant interval. MOVE inputs may originate outside it. */
export function occurrencesInRange(series: Series, exceptions: readonly OccurrenceException[], start: Date, end: Date, includeCancelled = false): ClassOccurrence[] {
  const byDate = new Map(exceptions.map((exception) => [exception.originalDate, exception]));
  const occurrences = new Map<string, ClassOccurrence>();
  let day = Temporal.PlainDate.from(academicDate(start, series.timezone)).subtract({ days: 1 });
  const stop = Temporal.PlainDate.from(academicDate(end, series.timezone));
  if (day.toString() < series.originalStartDate) day = Temporal.PlainDate.from(series.originalStartDate);
  day = day.add({ days: (series.weekday - day.dayOfWeek + 7) % 7 });
  while (Temporal.PlainDate.compare(day, stop) <= 0 && Temporal.PlainDate.compare(day, series.originalEndDate) <= 0 && (!series.retiredFromDate || Temporal.PlainDate.compare(day, series.retiredFromDate) < 0)) {
    const original = originalOccurrence(series, day.toString());
    if (original) {
      const effective = applyException(original, byDate.get(original.originalDate));
      if (overlaps(effective, start, end) && (includeCancelled || effective.state !== "CANCELLED")) occurrences.set(effective.originalDate, effective);
    }
    day = day.add({ days: 7 });
  }
  for (const exception of exceptions) {
    if (exception.kind !== "MOVE") continue;
    const original = originalOccurrence(series, exception.originalDate);
    if (!original) continue;
    const effective = applyException(original, exception);
    if (overlaps(effective, start, end)) occurrences.set(effective.originalDate, effective);
  }
  return [...occurrences.values()].sort(compareOccurrences);
}

/** Seek the next normal candidate directly, then compare sparse MOVE candidates. */
export function nextOccurrence(series: Series, exceptions: readonly OccurrenceException[], now: Date): ClassOccurrence | null {
  const byDate = new Map(exceptions.map((exception) => [exception.originalDate, exception]));
  const candidates: ClassOccurrence[] = [];
  for (const exception of exceptions) {
    if (exception.kind !== "MOVE" || !exception.replacementStartsAt || exception.replacementStartsAt < now) continue;
    const original = originalOccurrence(series, exception.originalDate);
    if (original) candidates.push(applyException(original, exception));
  }
  let day = Temporal.PlainDate.from(academicDate(now, series.timezone));
  if (day.toString() < series.originalStartDate) day = Temporal.PlainDate.from(series.originalStartDate);
  day = day.add({ days: (series.weekday - day.dayOfWeek + 7) % 7 });
  while (Temporal.PlainDate.compare(day, series.originalEndDate) <= 0 && (!series.retiredFromDate || Temporal.PlainDate.compare(day, series.retiredFromDate) < 0)) {
    const original = originalOccurrence(series, day.toString());
    if (original && original.startsAt >= now && !byDate.has(original.originalDate)) { candidates.push(original); break; }
    day = day.add({ days: 7 });
  }
  return candidates.sort(compareOccurrences)[0] ?? null;
}

export function localDayRange(date: string, timezone: string) {
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime(timezone);
  const end = day.add({ days: 1 }).toZonedDateTime(timezone);
  // Calendar-day addition deliberately permits 23/25-hour days and skipped dates.
  return { start: new Date(start.epochMilliseconds), end: new Date(end.epochMilliseconds) };
}
