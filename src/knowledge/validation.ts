import { AcademicError } from "../academic/errors";
import { idInput, optionalText, textInput } from "../academic/validation";
export type KnowledgeKind = "NOTE" | "RESOURCE";
export function invalid(message: string): never { throw new AcademicError("INVALID_INPUT", message); }
export function knowledgeKind(value: unknown): KnowledgeKind {
  if (value !== "NOTE" && value !== "RESOURCE") invalid("Choose Note or Resource.");
  return value;
}
export function booleanInput(value: unknown, label: string): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return invalid(`${label} must be explicitly true or false.`);
}
export function contextInput(input: Record<string, unknown>): string | null | undefined {
  for (const key of ["termId", "projectId", "taskId", "assignmentId"]) {
    if (input[key] != null && input[key] !== "") invalid("Knowledge supports only standalone or Course context.");
  }
  if (input.courseId === undefined) return undefined;
  return input.courseId === null || input.courseId === "" ? null : idInput(input.courseId);
}
export function contentInput(value: unknown): string {
  if (typeof value !== "string" || value.includes("\0")) invalid("Note content must be text without null characters.");
  return value;
}
function titleInput(value: unknown) {
  const title = textInput(value, "Title");
  if (title.includes("\0")) invalid("Title cannot contain null characters.");
  return title;
}
export function resourceUrl(value: unknown): string {
  if (typeof value !== "string" || !/^https?:\/\/[^/?#\s]+(?:[/?#].*)?$/i.test(value) || /[\s\\]|\p{Cc}/u.test(value) || /%(?![\da-f]{2})/i.test(value)) invalid("Use an absolute HTTP or HTTPS URL without whitespace or control characters.");
  let parsed: URL;
  try { parsed = new URL(value); } catch { return invalid("Resource URL is malformed."); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) invalid("Resource URLs require HTTP/HTTPS and cannot contain credentials.");
  return value;
}
export function noteMetadataInput(input: Record<string, unknown>) {
  return { title: titleInput(input.title), ...(input.pinned === undefined ? {} : { pinned: booleanInput(input.pinned, "Pinned") }) };
}
export function noteInput(input: Record<string, unknown>) {
  return { ...noteMetadataInput(input), contentMarkdown: contentInput(input.contentMarkdown === undefined ? "" : input.contentMarkdown) };
}
export function resourceInput(input: Record<string, unknown>) {
  const description = optionalText(input.description, "Description");
  if (description?.includes("\0")) invalid("Description cannot contain null characters.");
  return { title: titleInput(input.title), url: resourceUrl(input.url), description };
}
