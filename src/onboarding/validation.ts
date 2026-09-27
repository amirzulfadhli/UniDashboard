export class OnboardingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingValidationError";
  }
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new OnboardingValidationError(`${label} is required.`);
  const text = value.trim();
  if (!text) throw new OnboardingValidationError(`${label} is required.`);
  if (text.length > maxLength) throw new OnboardingValidationError(`${label} is too long.`);
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new OnboardingValidationError(`${label} is invalid.`);
  const text = value.trim();
  if (text.length > maxLength) throw new OnboardingValidationError(`${label} is too long.`);
  return text || null;
}

export function parseIanaTimezone(value: unknown): string {
  const timezone = requiredText(value, "Timezone", 100);
  // Offset strings accepted by some Intl implementations are not IANA names.
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timezone)) {
    throw new OnboardingValidationError("Choose a valid IANA timezone.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new OnboardingValidationError("Choose a valid IANA timezone.");
  }
  return timezone;
}

export function parseLiteralDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OnboardingValidationError(`${label} must be a date in YYYY-MM-DD format.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined || year < 1 || month < 1 || month > 12) {
    throw new OnboardingValidationError(`${label} is not a calendar date.`);
  }
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (daysInMonth === undefined || day < 1 || day > daysInMonth) {
    throw new OnboardingValidationError(`${label} is not a calendar date.`);
  }
  return value;
}

export function parseProfileInput(input: Record<string, unknown>) {
  return {
    displayName: optionalText(input.displayName, "Display name", 120),
    timezone: parseIanaTimezone(input.timezone),
  };
}

export function parseProgrammeInput(input: Record<string, unknown>) {
  return {
    name: requiredText(input.name, "Programme name", 200),
    description: optionalText(input.description, "Programme description", 2000),
  };
}

export function parseTermInput(input: Record<string, unknown>) {
  const name = requiredText(input.name, "Term name", 200);
  const academicTimezone = parseIanaTimezone(input.academicTimezone);
  const startsOn = parseLiteralDate(input.startsOn, "Start date");
  const endsOn = parseLiteralDate(input.endsOn, "End date");
  const teachingStartsOn = parseLiteralDate(input.teachingStartsOn, "Teaching start date");
  if (startsOn > endsOn) throw new OnboardingValidationError("Start date must be on or before end date.");
  if (teachingStartsOn < startsOn || teachingStartsOn > endsOn) {
    throw new OnboardingValidationError("Teaching start date must be within the term.");
  }
  return { name, academicTimezone, startsOn, endsOn, teachingStartsOn };
}
