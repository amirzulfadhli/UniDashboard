import { Temporal } from "@js-temporal/polyfill";
import { AcademicError } from "../academic/errors";
import { dateInput, idInput, optionalText, textInput, timeInput, zoneInput } from "../academic/validation";
import { localInstant } from "../academic/recurrence";

export class WorkError extends AcademicError {
  constructor(code: "NOT_FOUND" | "INVALID_INPUT" | "INVALID_STATE" | "CONFLICT", message: string) { super(code, message); this.name = "WorkError"; }
}
export function bad(message: string): never { throw new WorkError("INVALID_INPUT", message); }
export function missing(): never { throw new WorkError("NOT_FOUND", "Work record not found."); }
export type WorkKind = "TASK" | "PROJECT" | "ASSIGNMENT";
export function workKind(value: unknown): WorkKind {
  if (value !== "TASK" && value !== "PROJECT" && value !== "ASSIGNMENT") bad("Choose Task, Project, or Assignment.");
  return value;
}
export function archiveInput(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return bad("Archive must be explicitly true or false.");
}
export const optionalId = (value: unknown) => value === undefined || value === null || value === "" ? null : idInput(value);
export function metadata(input: Record<string, unknown>): { title: string; description: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" } {
  const priority = input.priority ?? "MEDIUM";
  if (priority !== "LOW" && priority !== "MEDIUM" && priority !== "HIGH" && priority !== "URGENT") bad("Choose a valid priority.");
  return { title: textInput(input.title, "Title"), description: optionalText(input.description, "Description"), priority };
}
export type Deadline = { deadlineKind: "NONE" | "DATE_ONLY" | "TIMED"; dueDate: string | null; dueAt: Date | null; dueTimezone: string | null };
const present = (value: unknown) => value != null && value !== "";
export function deadlineInput(input: Record<string, unknown>): Deadline {
  if (input.deadlineKind === "NONE") {
    if (["dueDate", "dueAt", "dueTimezone", "dueLocalDate", "dueLocalTime"].some((key) => present(input[key]))) bad("No-deadline work cannot contain a deadline payload.");
    return { deadlineKind: "NONE", dueDate: null, dueAt: null, dueTimezone: null };
  }
  const dueTimezone = zoneInput(input.dueTimezone);
  if (input.deadlineKind === "DATE_ONLY") {
    if (["dueAt", "dueLocalDate", "dueLocalTime"].some((key) => present(input[key]))) bad("Date-only deadlines cannot contain a timed payload.");
    return { deadlineKind: "DATE_ONLY", dueDate: dateInput(input.dueDate, "Due date"), dueAt: null, dueTimezone };
  }
  if (input.deadlineKind !== "TIMED") bad("Choose NONE, DATE_ONLY, or TIMED.");
  if (present(input.dueDate)) bad("Timed deadlines cannot also have a date-only payload.");
  let dueAt: Date;
  if (present(input.dueAt)) {
    if (present(input.dueLocalDate) || present(input.dueLocalTime)) bad("Choose one timed deadline representation.");
    if (typeof input.dueAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.dueAt)) bad("Due instant must be ISO format with an explicit offset.");
    try { dueAt = new Date(Temporal.Instant.from(input.dueAt).epochMilliseconds); } catch { return bad("Due instant is invalid."); }
  } else {
    const instant = localInstant(dateInput(input.dueLocalDate), timeInput(input.dueLocalTime), dueTimezone);
    if (!instant) bad("The deadline time does not exist in this timezone.");
    dueAt = instant;
  }
  if (!Number.isFinite(dueAt.getTime())) bad("Due instant is invalid.");
  return { deadlineKind: "TIMED", dueDate: null, dueAt, dueTimezone };
}
