export type AcademicErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "INVALID_STATE" | "CONFLICT";

export class AcademicError extends Error {
  constructor(public readonly code: AcademicErrorCode, message: string) {
    super(message);
    this.name = "AcademicError";
  }
}

export function invalid(message: string): never {
  throw new AcademicError("INVALID_INPUT", message);
}

export function notFound(): never {
  throw new AcademicError("NOT_FOUND", "Academic record not found.");
}
