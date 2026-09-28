import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadAuthConfiguration } from "../src/auth/config";
import { getPrisma } from "../src/auth/db";
import { saveProfile, completeFirstTerm } from "../src/onboarding/service";
import { archiveCourse, archiveTerm, createCourse } from "../src/academic/records";
const { baseURL, secret } = loadAuthConfiguration();
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/unios_test") throw new Error("Knowledge smoke requires disposable unios_test.");
const prisma = getPrisma();
const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
const get = (path: string, cookie = "") => fetch(`${baseURL}${path}`, { headers: { cookie }, redirect: "manual" });
async function account() {
  const response = await fetch(`${baseURL}/api/auth/sign-up/email`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json" }, body: JSON.stringify({ email: `${randomUUID()}@example.test`, name: "Knowledge smoke", password: "Knowledge-smoke-password-123!" }) });
  assert.equal(response.status, 200);
  const identity = (await response.json() as { user: { id: string } }).user;
  const cookie = response.headers.getSetCookie().find((item) => item.includes("session_token="))!.split(";")[0]!;
  await get("/onboarding", cookie);
  const auth = await prisma.authUser.findUniqueOrThrow({ where: { id: identity.id } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: auth.domainUserId! } });
  await saveProfile(prisma, owner, { displayName: "Knowledge smoke", timezone: "UTC" });
  await completeFirstTerm(prisma, owner, { name: "Knowledge term", academicTimezone: "UTC", startsOn: "2026-01-01", endsOn: "2026-12-31", teachingStartsOn: "2026-01-01" });
  const term = await prisma.term.findFirstOrThrow({ where: { ownerId: owner.id } });
  const course = await createCourse(prisma, owner, { termId: term.id, courseCode: "KNOWHTTP", title: "Knowledge course" });
  return { owner, cookie, term, course };
}
async function action(name: string, data: Record<string, string>, cookie: string, origin = baseURL) {
  const id = Object.entries(manifest.node).find(([, value]) => value.exportedName === name)?.[0]; assert.ok(id, `built ${name}`);
  const form = new FormData(); for (const [key, value] of Object.entries(data)) form.set(`_1_${key}`, value); form.set("0", '["$K1"]');
  return fetch(`${baseURL}/notes`, { method: "POST", headers: { origin, cookie, "Next-Action": id }, body: form, redirect: "manual" });
}
async function save(name: string, data: Record<string, string>, cookie: string) {
  const response = await action(name, data, cookie); assert.ok(response.status < 400);
  assert.ok(response.headers.get("x-action-redirect")); assert.ok(!response.headers.get("x-action-redirect")!.includes("error="), `${name}: ${response.headers.get("x-action-redirect")}`);
}
async function rejected(name: string, data: Record<string, string>, cookie: string) { assert.ok((await action(name, data, cookie)).headers.get("x-action-redirect")?.includes("error=")); }
async function html(path: string, cookie: string) { const response = await get(path, cookie); assert.equal(response.status, 200); const output = await response.text(); assert.ok(!output.includes(secret)); return output; }
function noteEditForms(page: string, id: string) {
  const forms = [...page.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([form]) => form).filter((form) => form.includes(`value="${id}"`));
  const metadata = forms.find((form) => form.includes('name="title"') && form.includes('name="pinned"'));
  const content = forms.find((form) => form.includes('name="contentMarkdown"'));
  assert.ok(metadata && content, "production Note editor renders separate metadata and content forms");
  assert.ok(!metadata.includes('name="contentMarkdown"'), "metadata form never submits the browser-normalized textarea");
  assert.ok(!content.includes('name="title"') && !content.includes('name="courseId"') && !content.includes('name="pinned"'));
}
try {
  for (const path of ["/notes", "/resources"]) { const response = await get(path); assert.equal(response.status, 307); assert.equal(response.headers.get("location"), "/sign-in"); }
  const a = await account(), b = await account();
  const content = '  <script>window.bad=1</script> <b>text</b> & "quotes"  ';
  await save("createKnowledgeAction", { kind: "NOTE", title: "HTTP note <img src=x onerror=alert(1)>", contentMarkdown: content, pinned: "true", courseId: a.course.id, ownerId: b.owner.id, userId: b.owner.id, authUserId: b.owner.id }, a.cookie);
  const note = await prisma.note.findFirstOrThrow({ where: { ownerId: a.owner.id } }); assert.equal(note.contentMarkdown, content); assert.equal(note.pinned, true); assert.equal(note.courseId, a.course.id);
  const noteHtml = await html(`/notes?id=${note.id}`, a.cookie);
  assert.ok(noteHtml.includes("&lt;script&gt;window.bad=1&lt;/script&gt;")); assert.ok(noteHtml.includes("&lt;img src=x onerror=alert(1)&gt;")); assert.ok(!noteHtml.includes("<script>window.bad=1")); assert.ok(!noteHtml.includes("<img src=x onerror="));
  noteEditForms(noteHtml, note.id);
  await save("updateKnowledgeAction", { kind: "NOTE", id: note.id, title: "HTTP edited note", pinned: "false", courseId: a.course.id }, a.cookie);
  await save("updateNoteContentAction", { kind: "NOTE", id: note.id, contentMarkdown: content + " edited" }, a.cookie);
  assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).contentMarkdown, content + " edited");
  assert.ok((await html(`/notes?course=${a.course.id}`, a.cookie)).includes("HTTP edited note"));
  assert.ok(!(await html("/notes?course=standalone", a.cookie)).includes("HTTP edited note"));
  await save("archiveKnowledgeAction", { kind: "NOTE", id: note.id, archived: "true" }, a.cookie);
  assert.ok(!(await html("/notes", a.cookie)).includes("HTTP edited note"));
  await rejected("archiveKnowledgeAction", { kind: "NOTE", id: note.id, archived: "malformed" }, a.cookie);
  assert.ok((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).archivedAt);
  assert.ok((await html("/notes?view=MANAGEMENT", a.cookie)).includes("HTTP edited note"));
  await save("archiveKnowledgeAction", { kind: "NOTE", id: note.id, archived: "false" }, a.cookie);
  const url = "https://example.com/path?x=1&y=2#section";
  await save("createKnowledgeAction", { kind: "RESOURCE", title: "HTTP resource <script>label</script>", url, description: "HTML-like <b>description</b>", courseId: a.course.id, ownerId: b.owner.id }, a.cookie);
  const resource = await prisma.resource.findFirstOrThrow({ where: { ownerId: a.owner.id } });
  const resourceHtml = await html(`/resources?id=${resource.id}`, a.cookie);
  assert.ok(resourceHtml.includes('href="https://example.com/path?x=1&amp;y=2#section"')); assert.ok(resourceHtml.includes('rel="noopener noreferrer"')); assert.ok(resourceHtml.includes('target="_blank"')); assert.ok(resourceHtml.includes("&lt;script&gt;label&lt;/script&gt;")); assert.ok(!resourceHtml.includes("<script>label"));
  await save("updateKnowledgeAction", { kind: "RESOURCE", id: resource.id, title: "HTTP edited resource", url: "http://localhost:3000/path", description: "Edited", courseId: a.course.id }, a.cookie);
  assert.equal((await prisma.resource.findUniqueOrThrow({ where: { id: resource.id } })).url, "http://localhost:3000/path");
  assert.ok((await html(`/resources?course=${a.course.id}`, a.cookie)).includes("HTTP edited resource"));
  await save("archiveKnowledgeAction", { kind: "RESOURCE", id: resource.id, archived: "true" }, a.cookie);
  assert.ok(!(await html("/resources", a.cookie)).includes("HTTP edited resource"));
  await rejected("archiveKnowledgeAction", { kind: "RESOURCE", id: resource.id }, a.cookie);
  assert.ok((await prisma.resource.findUniqueOrThrow({ where: { id: resource.id } })).archivedAt);
  await save("archiveKnowledgeAction", { kind: "RESOURCE", id: resource.id, archived: "false" }, a.cookie);
  for (const [kind, row, path, title] of [["NOTE", note, "/notes", "HTTP edited note"], ["RESOURCE", resource, "/resources", "HTTP edited resource"]] as const) {
    assert.equal((await get(`${path}?id=${row.id}`, b.cookie)).status, 404);
    assert.equal((await get(`${path}?course=${b.course.id}`, a.cookie)).status, 404);
    assert.equal((await get(`${path}?course=bad-id`, a.cookie)).status, 404);
    const data = kind === "NOTE" ? { contentMarkdown: content } : { url };
    await rejected("updateKnowledgeAction", { kind, id: row.id, title: "Forged edit", ...data }, b.cookie);
    await rejected("archiveKnowledgeAction", { kind, id: row.id, archived: "false" }, b.cookie);
    await rejected("createKnowledgeAction", { kind, title: "Foreign attachment", courseId: b.course.id, ...data }, a.cookie);
    await rejected("createKnowledgeAction", { kind, title: "Malformed context", courseId: "bad-id", ...data }, a.cookie);
    await archiveCourse(prisma, a.owner, a.course.id, true);
    assert.ok((await html(path, a.cookie)).includes(title));
    assert.ok(!(await html(`${path}?course=${a.course.id}`, a.cookie)).includes(title));
    assert.ok((await html(`${path}?view=MANAGEMENT&course=${a.course.id}`, a.cookie)).includes(title));
    await rejected("createKnowledgeAction", { kind, title: "Archived attachment", courseId: a.course.id, ...data }, a.cookie);
    await archiveCourse(prisma, a.owner, a.course.id, false);
    assert.ok((await html(`${path}?course=${a.course.id}`, a.cookie)).includes(title));
  }
  await archiveTerm(prisma, a.owner, a.term.id, true);
  assert.ok((await html("/notes", a.cookie)).includes("HTTP edited note")); assert.ok(!(await html(`/notes?course=${a.course.id}`, a.cookie)).includes("HTTP edited note"));
  await archiveTerm(prisma, a.owner, a.term.id, false);
  for (const unsafe of ["javascript:alert(1)", "data:text/html,x", "//example.com", "https://user:pass@example.com", "https://example.com/\n"]) {
    await rejected("createKnowledgeAction", { kind: "RESOURCE", title: "Unsafe URL", url: unsafe }, a.cookie);
    await rejected("updateKnowledgeAction", { kind: "RESOURCE", id: resource.id, title: "Unsafe URL", url: unsafe }, a.cookie);
  }
  assert.equal(await prisma.resource.count({ where: { ownerId: a.owner.id, title: "Unsafe URL" } }), 0);
  const legacy = await prisma.resource.create({ data: { ownerId: a.owner.id, title: "Legacy invalid URL", url: "https://user:pass@example.com" } });
  assert.ok(!(await html(`/resources?id=${legacy.id}`, a.cookie)).includes('href="https://user:pass@example.com"'));
  await save("updateKnowledgeAction", { kind: "RESOURCE", id: resource.id, title: "HTTP edited resource", url, courseId: "" }, a.cookie);
  assert.equal((await prisma.resource.findUniqueOrThrow({ where: { id: resource.id } })).courseId, null);
  assert.ok((await html("/resources?course=standalone", a.cookie)).includes("HTTP edited resource"));
  const exactSources = [
    "  LF\nwith\ttab 😀  ",
    "  CRLF\r\nwith\ttab 😀  ",
    "  CR\rwith\ttab 😀  ",
    "\n  alpha\nbeta\r\ngamma\tdelta\rend😀  <b>**source**</b>",
  ];
  for (const [index, source] of exactSources.entries()) {
    const record = await prisma.note.create({ data: { ownerId: a.owner.id, title: `M1 source ${index}`, contentMarkdown: source } });
    noteEditForms(await html(`/notes?id=${record.id}`, a.cookie), record.id);
    const preserved = async () => assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: record.id } })).contentMarkdown, source);
    await save("updateKnowledgeAction", { kind: "NOTE", id: record.id, title: `M1 title ${index}`, pinned: "false", courseId: "" }, a.cookie); await preserved();
    await save("updateKnowledgeAction", { kind: "NOTE", id: record.id, title: `M1 title ${index}`, pinned: "true", courseId: "" }, a.cookie); await preserved();
    await save("updateKnowledgeAction", { kind: "NOTE", id: record.id, title: `M1 title ${index}`, pinned: "false", courseId: "" }, a.cookie); await preserved();
    await save("updateKnowledgeAction", { kind: "NOTE", id: record.id, title: `M1 title ${index}`, pinned: "false", courseId: a.course.id }, a.cookie); await preserved();
    await save("updateKnowledgeAction", { kind: "NOTE", id: record.id, title: `M1 title ${index}`, pinned: "false", courseId: "" }, a.cookie); await preserved();
    await save("archiveKnowledgeAction", { kind: "NOTE", id: record.id, archived: "true" }, a.cookie); await preserved();
    await save("archiveKnowledgeAction", { kind: "NOTE", id: record.id, archived: "false" }, a.cookie); await preserved();
    await rejected("updateKnowledgeAction", { kind: "NOTE", id: record.id, title: "Forged content", contentMarkdown: "unexpected" }, a.cookie); await preserved();
    if (index === exactSources.length - 1) {
      const intentional = "\n  new\ncontent\rwith 😀  ";
      const submitted = new FormData(); submitted.set("contentMarkdown", intentional);
      const expected = (await new Response(submitted).formData()).get("contentMarkdown");
      assert.notEqual(expected, intentional, "multipart form submission normalizes textarea line endings");
      await save("updateNoteContentAction", { kind: "NOTE", id: record.id, contentMarkdown: intentional }, a.cookie);
      assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: record.id } })).contentMarkdown, expected);
      await save("updateKnowledgeAction", { kind: "NOTE", id: record.id, title: "After intentional edit", pinned: "false", courseId: "" }, a.cookie);
      assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: record.id } })).contentMarkdown, expected);
      await rejected("updateNoteContentAction", { kind: "NOTE", id: record.id }, a.cookie);
      await rejected("updateNoteContentAction", { kind: "RESOURCE", id: record.id, contentMarkdown: "wrong kind" }, a.cookie);
      await rejected("updateNoteContentAction", { kind: "NOTE", id: record.id, contentMarkdown: "foreign" }, b.cookie);
    }
  }
  const anonymous = await action("createKnowledgeAction", { kind: "NOTE", title: "Anonymous forged", contentMarkdown: "x" }, ""); assert.ok(anonymous.headers.get("x-action-redirect")?.includes("/sign-in"));
  assert.ok((await action("createKnowledgeAction", { kind: "NOTE", title: "Origin forged", contentMarkdown: "x" }, a.cookie, "https://attacker.example")).status >= 400);
  assert.equal(await prisma.note.count({ where: { title: { in: ["Anonymous forged", "Origin forged", "Forged edit"] } } }), 0);
  console.log("Authenticated Notes/Resources forms, reads, edits, archives, context/history, escaped content, safe links, foreign/forged IDs, malformed input and origin protections passed; Note M1 exact-source preservation and intentional content editing passed through production forms/actions");
} finally { await prisma.$disconnect(); }
