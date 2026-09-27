import { Temporal } from "@js-temporal/polyfill";
import { OnboardingValidationError, parseIanaTimezone, parseLiteralDate, parseTermInput } from "../onboarding/validation";
import { AcademicError, invalid } from "./errors";

export function existingValidation<T>(validate: () => T): T {
  try { return validate(); } catch (error) {
    if (error instanceof OnboardingValidationError) throw new AcademicError("INVALID_INPUT", error.message);
    throw error;
  }
}
export const termInput = (input: Record<string, unknown>) => existingValidation(() => parseTermInput(input));
export const dateInput = (value: unknown, label = "Date") => existingValidation(() => parseLiteralDate(value, label));
export const zoneInput = (value: unknown) => existingValidation(() => parseIanaTimezone(value));

export function idInput(value: unknown): string {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) invalid("Choose a valid academic record.");
  return value;
}
export function textInput(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) invalid(`${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
export function optionalText(value: unknown, label: string, max = 2000): string | null {
  if (value === undefined || value === null || value === "") return null;
  return textInput(value, label, max);
}
export function integerInput(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" && typeof value !== "string") invalid(`${label} is invalid.`);
  if (value === "" || (typeof value === "string" && !/^\d+$/.test(value))) invalid(`${label} is invalid.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) invalid(`${label} must be between ${min} and ${max}.`);
  return parsed;
}
export function timeInput(value: unknown): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) invalid("Use a local time in HH:MM or HH:MM:SS format.");
  return value.length === 5 ? `${value}:00` : value;
}
export function scheduleInput(input: Record<string, unknown>) {
  const weekday = integerInput(input.weekday, "Weekday", 1, 7);
  const endDayOffset = integerInput(input.endDayOffset, "End day offset", 0, 1);
  const localStartTime = timeInput(input.localStartTime);
  const localEndTime = timeInput(input.localEndTime);
  const seconds = (time: string) => time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  const duration = seconds(localEndTime) - seconds(localStartTime) + endDayOffset * 86400;
  if (duration <= 0 || duration > 86400) invalid("Class duration must be greater than zero and at most 24 hours.");
  const originalStartDate = dateInput(input.originalStartDate, "Series start");
  const originalEndDate = dateInput(input.originalEndDate, "Series end");
  if (originalStartDate > originalEndDate) invalid("Series start must be on or before its end.");
  const start = Temporal.PlainDate.from(originalStartDate);
  if (start.add({ days: (weekday - start.dayOfWeek + 7) % 7 }).toString() > originalEndDate) invalid("The range must contain a scheduled weekday.");
  return { weekday, endDayOffset, localStartTime, localEndTime, originalStartDate, originalEndDate,
    timezone: zoneInput(input.timezone), location: optionalText(input.location, "Location", 500) };
}

// Prisma's UTC-configured adapter exposes DATE/TIME as transport carriers only.
export const literalDate = (value: Date) => value.toISOString().slice(0, 10);
export const literalTime = (value: Date) => value.toISOString().slice(11, 19);
