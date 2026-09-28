import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "pg";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaClient } from "../src/db/client";
import { withOwnerTransaction } from "../src/db/owner-transaction";
import { AcademicError } from "../src/academic/errors";
import { archiveCourse, archiveTerm, courseLifecycle, createCourse, createTerm, ownedCourse, termLifecycle, updateCourse } from "../src/academic/records";
import { archiveKnowledge, createKnowledge, ownedKnowledge, updateKnowledge, updateNoteContent, updateNoteMetadata } from "../src/knowledge/service";
import { knowledgeOptions, queryKnowledge } from "../src/knowledge/queries";
import type { KnowledgeKind } from "../src/knowledge/validation";
const prisma = createPrismaClient();
after(async () => prisma.$disconnect());
const code = (value: string) => (error: unknown) => error instanceof AcademicError && error.code === value;
const termData = { name: "Knowledge term", startsOn: "2026-01-01", endsOn: "2026-12-31", teachingStartsOn: "2026-01-01", academicTimezone: "UTC" };
const payload = (kind: KnowledgeKind, title = "Knowledge") => kind === "NOTE" ? { title, contentMarkdown: "  # Notes\n\n<script>text</script> & \"quotes\"\t中文\r\n", pinned: true } : { title, url: "https://example.com/path?x=1#section", description: "Resource description" };
async function fixture() {
  const owner = await prisma.user.create({ data: {} });
  const term = await createTerm(prisma, owner, termData);
  const course = await createCourse(prisma, owner, { termId: term.id, courseCode: "KNOW", title: "Knowledge course" });
  return { owner, term, course };
}
test("Note metadata mutation never writes exact source, while explicit content mutation does", async () => {
  const a = await fixture(), b = await fixture();
  const sources = ["  alpha\nbeta\t😀  ", "  alpha\r\nbeta\t😀  ", "  alpha\rbeta\t😀  ", "\n  alpha\nbeta\r\ngamma\tdelta\rend😀  <b>Markdown **source**</b>"];
  for (const source of sources) {
    const note = await createKnowledge(prisma, a.owner, "NOTE", { title: "Exact source", contentMarkdown: source });
    for (const input of [
      { title: "Title changed", pinned: "false", courseId: "" },
      { title: "Pinned", pinned: "true", courseId: "" },
      { title: "Unpinned", pinned: "false", courseId: "" },
      { title: "Course assigned", pinned: "false", courseId: a.course.id },
      { title: "Detached", pinned: "false", courseId: "" },
    ]) {
      await updateNoteMetadata(prisma, a.owner, note.id, input);
      assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).contentMarkdown, source);
    }
    await assert.rejects(updateNoteMetadata(prisma, a.owner, note.id, { title: "Forged", contentMarkdown: "rewritten" }), code("INVALID_INPUT"));
    assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).contentMarkdown, source);
    await assert.rejects(updateNoteMetadata(prisma, b.owner, note.id, { title: "Foreign" }), code("NOT_FOUND"));
    await assert.rejects(updateNoteContent(prisma, b.owner, note.id, "Foreign"), code("NOT_FOUND"));
    const edited = "  edited\nline\rfinal😀  ";
    await updateNoteContent(prisma, a.owner, note.id, edited);
    assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).contentMarkdown, edited);
    await updateNoteMetadata(prisma, a.owner, note.id, { title: "After content edit" });
    assert.equal((await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).contentMarkdown, edited);
    await assert.rejects(updateNoteContent(prisma, a.owner, note.id, null), code("INVALID_INPUT"));
  }
});
test("Note/Resource operations preserve content, duplicates, archive independence and deterministic lists", async () => {
  const a = await fixture();
  for (const kind of ["NOTE", "RESOURCE"] as const) {
    const row = await createKnowledge(prisma, a.owner, kind, { ...payload(kind), courseId: a.course.id });
    assert.equal(row.id[14], "7");
    const duplicate = await createKnowledge(prisma, a.owner, kind, payload(kind));
    assert.notEqual(row.id, duplicate.id);
    const edited = await updateKnowledge(prisma, a.owner, kind, row.id, { ...payload(kind, "Updated"), ...(kind === "NOTE" ? { contentMarkdown: " \n  " } : { url: "http://localhost:3000/path" }) });
    assert.equal(edited.courseId, a.course.id);
    if ("contentMarkdown" in edited) { assert.equal(edited.contentMarkdown, " \n  "); assert.equal(edited.pinned, true); }
    else assert.equal(edited.url, "http://localhost:3000/path");
    assert.equal((await queryKnowledge(prisma, a.owner, kind))[0]!.id, row.id);
    assert.deepEqual((await queryKnowledge(prisma, a.owner, kind, { courseId: null })).map((record) => record.id), [duplicate.id]);
    const archived = await archiveKnowledge(prisma, a.owner, kind, row.id, "true");
    assert.equal(archived.courseId, row.courseId); assert.ok(archived.archivedAt);
    assert.ok(!(await queryKnowledge(prisma, a.owner, kind)).some((record) => record.id === row.id));
    assert.equal((await queryKnowledge(prisma, a.owner, kind, { view: "MANAGEMENT", includeArchived: true })).length, 2);
    const restored = await archiveKnowledge(prisma, a.owner, kind, row.id, "false");
    assert.equal(restored.archivedAt, null); assert.equal(restored.createdAt.getTime(), row.createdAt.getTime());
    if ("contentMarkdown" in restored && "contentMarkdown" in edited) assert.equal(restored.contentMarkdown, edited.contentMarkdown);
    else if ("url" in restored && "url" in edited) assert.equal(restored.url, edited.url);
    for (const value of [undefined, null, "", "TRUE", "no", 0, 1]) await assert.rejects(archiveKnowledge(prisma, a.owner, kind, row.id, value), code("INVALID_INPUT"));
    assert.equal((await ownedKnowledge(prisma, a.owner, kind, row.id)).archivedAt, null);
  }
  for (const contentMarkdown of ["", "\t \r\n", "😀中文\n".repeat(30000)]) {
    const note = await createKnowledge(prisma, a.owner, "NOTE", { title: "Content", contentMarkdown });
    assert.ok("contentMarkdown" in note && note.contentMarkdown === contentMarkdown);
    const edited = await updateKnowledge(prisma, a.owner, "NOTE", note.id, { title: "Metadata only" });
    assert.ok("contentMarkdown" in edited && edited.contentMarkdown === contentMarkdown);
  }
  for (const contentMarkdown of [null, 42, "bad\0text"]) await assert.rejects(createKnowledge(prisma, a.owner, "NOTE", { title: "Bad content", contentMarkdown }), code("INVALID_INPUT"));
  await assert.rejects(createKnowledge(prisma, a.owner, "NOTE", { title: "  " }), code("INVALID_INPUT"));
  await assert.rejects(createKnowledge(prisma, a.owner, "NOTE", { title: "X", pinned: "maybe" }), code("INVALID_INPUT"));
  for (const kind of ["NOTE", "RESOURCE"] as const) await assert.rejects(createKnowledge(prisma, a.owner, kind, { ...payload(kind), title: "bad\0title" }), code("INVALID_INPUT"));
  await assert.rejects(createKnowledge(prisma, a.owner, "RESOURCE", { ...payload("RESOURCE"), description: "bad\0description" }), code("INVALID_INPUT"));
});
test("all knowledge operations and context queries enforce ownership without unrelated failure paths", async () => {
  const a = await fixture(), b = await fixture();
  for (const kind of ["NOTE", "RESOURCE"] as const) {
    const foreign = await createKnowledge(prisma, b.owner, kind, { ...payload(kind), courseId: b.course.id });
    for (const attempt of [
      () => ownedKnowledge(prisma, a.owner, kind, foreign.id),
      () => updateKnowledge(prisma, a.owner, kind, foreign.id, payload(kind)),
      () => archiveKnowledge(prisma, a.owner, kind, foreign.id, true), () => archiveKnowledge(prisma, a.owner, kind, foreign.id, false),
      () => queryKnowledge(prisma, a.owner, kind, { courseId: b.course.id }),
      () => queryKnowledge(prisma, a.owner, kind, { courseId: b.course.id, view: "MANAGEMENT", includeArchived: true }),
      () => createKnowledge(prisma, a.owner, kind, { ...payload(kind), courseId: b.course.id }),
    ]) await assert.rejects(attempt(), code("NOT_FOUND"));
    const row = await createKnowledge(prisma, a.owner, kind, { ...payload(kind), id: foreign.id, noteId: foreign.id, resourceId: foreign.id, ownerId: b.owner.id, userId: b.owner.id, authUserId: b.owner.id });
    assert.equal(row.ownerId, a.owner.id); assert.notEqual(row.id, foreign.id);
    await assert.rejects(updateKnowledge(prisma, a.owner, kind, row.id, { ...payload(kind), courseId: b.course.id }), code("NOT_FOUND"));
    const edited = await updateKnowledge(prisma, a.owner, kind, row.id, { ...payload(kind), ownerId: b.owner.id, userId: b.owner.id, authUserId: b.owner.id });
    assert.equal(edited.ownerId, a.owner.id);
    assert.ok((await queryKnowledge(prisma, a.owner, kind, { view: "MANAGEMENT", includeArchived: true })).every((record) => record.ownerId === a.owner.id));
    for (const key of ["termId", "projectId", "taskId", "assignmentId"]) {
      const context = { [key]: b.term.id };
      await assert.rejects(createKnowledge(prisma, a.owner, kind, { ...payload(kind), ...context }), code("INVALID_INPUT"));
      await assert.rejects(updateKnowledge(prisma, a.owner, kind, row.id, { ...payload(kind), ...context }), code("INVALID_INPUT"));
      await assert.rejects(queryKnowledge(prisma, a.owner, kind, context), code("INVALID_INPUT"));
    }
    assert.deepEqual(await ownedKnowledge(prisma, b.owner, kind, foreign.id), foreign);
    await assert.rejects(ownedKnowledge(prisma, a.owner, kind, "bad-id"), code("INVALID_INPUT"));
    await assert.rejects(queryKnowledge(prisma, a.owner, kind, { courseId: "bad-id" }), code("INVALID_INPUT"));
    await assert.rejects(queryKnowledge(prisma, a.owner, kind, { includeArchived: "maybe" }), code("INVALID_INPUT"));
  }
  assert.ok((await knowledgeOptions(prisma, a.owner)).every((course) => course.ownerId === a.owner.id));
});
test("historical contexts survive archive/terminal states, while new attachments and active context views reject them", async () => {
  const a = await fixture();
  for (const kind of ["NOTE", "RESOURCE"] as const) {
    const row = await createKnowledge(prisma, a.owner, kind, { ...payload(kind), courseId: a.course.id });
    for (const mode of ["courseArchive", "termArchive", "courseTerminal", "termTerminal"] as const) {
      if (mode === "courseArchive") await archiveCourse(prisma, a.owner, a.course.id, true);
      if (mode === "termArchive") await archiveTerm(prisma, a.owner, a.term.id, true);
      if (mode === "courseTerminal") await courseLifecycle(prisma, a.owner, a.course.id, "COMPLETED");
      if (mode === "termTerminal") await termLifecycle(prisma, a.owner, a.term.id, "CLOSED");
      assert.ok((await queryKnowledge(prisma, a.owner, kind)).some((record) => record.id === row.id));
      assert.equal((await queryKnowledge(prisma, a.owner, kind, { courseId: a.course.id })).length, 0);
      assert.ok((await queryKnowledge(prisma, a.owner, kind, { courseId: a.course.id, view: "MANAGEMENT" })).some((record) => record.id === row.id));
      await assert.rejects(createKnowledge(prisma, a.owner, kind, { ...payload(kind), courseId: a.course.id }), code("INVALID_STATE"));
      const edited = await updateKnowledge(prisma, a.owner, kind, row.id, payload(kind, "Historical editable"));
      assert.equal(edited.courseId, a.course.id); assert.equal(edited.archivedAt, null);
      if (mode === "courseArchive") await archiveCourse(prisma, a.owner, a.course.id, false);
      if (mode === "termArchive") await archiveTerm(prisma, a.owner, a.term.id, false);
      if (mode === "courseTerminal") await courseLifecycle(prisma, a.owner, a.course.id, "ACTIVE");
      if (mode === "termTerminal") await termLifecycle(prisma, a.owner, a.term.id, "ACTIVE");
      assert.ok((await queryKnowledge(prisma, a.owner, kind, { courseId: a.course.id })).some((record) => record.id === row.id));
    }
    await updateKnowledge(prisma, a.owner, kind, row.id, { ...payload(kind), courseId: null });
    assert.ok((await ownedCourse(prisma, a.owner, a.course.id)).firstDependantAt);
    const other = await createTerm(prisma, a.owner, termData);
    await assert.rejects(updateCourse(prisma, a.owner, a.course.id, { termId: other.id, courseCode: "KNOW", title: "Locked" }), code("INVALID_STATE"));
  }
});
test("Resource create/edit validates actual URLs, controls and credentials before persistence", async () => {
  const a = await fixture();
  for (const url of ["https://example.com", "https://example.com/path?x=1#section", "http://localhost:3000/path", "https://例え.テスト/資料", "HTTPS://example.com", "http://[::1]:3000/path"]) {
    const record = await createKnowledge(prisma, a.owner, "RESOURCE", { title: "Valid", url });
    assert.ok("url" in record && record.url === url);
  }
  const row = await createKnowledge(prisma, a.owner, "RESOURCE", payload("RESOURCE"));
  const badUrls = ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "file:///tmp/x", "//example.com", "/path", "example.com", " \t", "https://", "https:///example.com", "https://example.com:99999", "https://user:password@example.com", "https://user@example.com", "https://example.com/with space", "https://example.com/\n", "https://example.com/\u0085", "https://example.com/\0", "https://example.com\\path", "https://example.com/%zz"];
  for (const url of badUrls) {
    await assert.rejects(createKnowledge(prisma, a.owner, "RESOURCE", { title: "Bad", url, courseId: a.course.id }), code("INVALID_INPUT"));
    await assert.rejects(updateKnowledge(prisma, a.owner, "RESOURCE", row.id, { title: "Bad", url, courseId: a.course.id }), code("INVALID_INPUT"));
    assert.deepEqual(await ownedKnowledge(prisma, a.owner, "RESOURCE", row.id), row);
  }
});
async function race(owner: { id: string }, operations: (() => Promise<unknown>)[]) {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const gate = withOwnerTransaction(prisma, owner.id, async () => { entered(); await held; }); await ready;
  const observer = new Client({ connectionString: process.env.DATABASE_URL! }); await observer.connect();
  const pending: Promise<unknown>[] = [];
  try {
    for (const operation of operations) {
      pending.push(operation()); let count = 0; const deadline = Date.now() + 3000;
      while (count < pending.length && Date.now() < deadline) count = Number((await observer.query<{ count: string }>("SELECT count(*)::text FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%public.app_user%'")).rows[0]!.count);
      assert.equal(count, pending.length, "mutations reached real account lock in order");
    }
  } finally { release(); await observer.end(); }
  await gate; return Promise.allSettled(pending);
}
test("real-lock races preserve earlier attachments and reject later attachments after parent changes", async () => {
  for (const kind of ["NOTE", "RESOURCE"] as const) for (const mode of ["courseArchive", "termArchive", "courseTerminal", "termTerminal"] as const) for (const parentFirst of [true, false]) {
    const a = await fixture();
    const parent = () => mode === "courseArchive" ? archiveCourse(prisma, a.owner, a.course.id, true) : mode === "termArchive" ? archiveTerm(prisma, a.owner, a.term.id, true) : mode === "courseTerminal" ? courseLifecycle(prisma, a.owner, a.course.id, "COMPLETED") : termLifecycle(prisma, a.owner, a.term.id, "CLOSED");
    const attach = () => createKnowledge(prisma, a.owner, kind, { ...payload(kind), courseId: a.course.id });
    const results = await race(a.owner, parentFirst ? [parent, attach] : [attach, parent]);
    if (parentFirst) { const result = results[1]!; assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.ok(code("INVALID_STATE")(result.reason)); assert.equal((await queryKnowledge(prisma, a.owner, kind)).length, 0); }
    else { assert.ok(results.every((result) => result.status === "fulfilled")); const retained = await queryKnowledge(prisma, a.owner, kind); assert.equal(retained.length, 1); assert.equal(retained[0]!.courseId, a.course.id); }
  }
});
test("reassignment/archive and simultaneous edits serialize complete context/content or URL changes", async () => {
  for (const kind of ["NOTE", "RESOURCE"] as const) {
    const a = await fixture(); const original = await createKnowledge(prisma, a.owner, kind, payload(kind));
    const result = await race(a.owner, [() => archiveCourse(prisma, a.owner, a.course.id, true), () => updateKnowledge(prisma, a.owner, kind, original.id, { ...payload(kind, "Partial should rollback"), courseId: a.course.id })]);
    assert.equal(result[1]!.status, "rejected"); assert.deepEqual(await ownedKnowledge(prisma, a.owner, kind, original.id), original);
    await archiveCourse(prisma, a.owner, a.course.id, false);
    const edits = await race(a.owner, [() => updateKnowledge(prisma, a.owner, kind, original.id, { ...payload(kind, "First"), courseId: a.course.id }), () => updateKnowledge(prisma, a.owner, kind, original.id, { ...payload(kind, "Second"), courseId: null, ...(kind === "NOTE" ? { contentMarkdown: "Second body" } : { url: "https://second.example/path" }) })]);
    assert.ok(edits.every((item) => item.status === "fulfilled"));
    const final = await ownedKnowledge(prisma, a.owner, kind, original.id); assert.equal(final.title, "Second"); assert.equal(final.courseId, null);
    if ("contentMarkdown" in final) assert.equal(final.contentMarkdown, "Second body"); else assert.equal(final.url, "https://second.example/path");
  }
});
test("post-write transaction failure rolls back content/context and Course dependant lock together", async () => {
  const failing = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (callback: (tx: unknown) => Promise<unknown>, options: object) => target.$transaction(async (tx) => { const result = await callback(tx); await tx.$executeRaw`SELECT 1/0`; return result; }, options);
  } }) as PrismaClient;
  for (const kind of ["NOTE", "RESOURCE"] as const) {
    const a = await fixture(); const original = await createKnowledge(prisma, a.owner, kind, payload(kind));
    await assert.rejects(updateKnowledge(failing, a.owner, kind, original.id, { ...payload(kind, "Must rollback"), courseId: a.course.id }), code("INVALID_STATE"));
    assert.deepEqual(await ownedKnowledge(prisma, a.owner, kind, original.id), original);
    assert.equal((await ownedCourse(prisma, a.owner, a.course.id)).firstDependantAt, null);
  }
});
test("context visibility and knowledge records use one snapshot during forced parent/item archive", async () => {
  for (const kind of ["NOTE", "RESOURCE"] as const) {
    const a = await fixture(), row = await createKnowledge(prisma, a.owner, kind, { ...payload(kind), courseId: a.course.id });
    let changed = false;
    const interleaved = new Proxy(prisma, { get(target, key) {
      if (key !== "$transaction") return Reflect.get(target, key);
      return (callback: (tx: unknown) => Promise<unknown>, options: object) => target.$transaction(async (tx) => callback(new Proxy(tx, { get(transaction, property) {
        if (property !== "course") return Reflect.get(transaction, property);
        return new Proxy(transaction.course, { get(delegate, method) {
          if (method !== "findFirst") return Reflect.get(delegate, method);
          return async (args: object) => { const result = await delegate.findFirst(args); if (!changed) { changed = true; await withOwnerTransaction(prisma, a.owner.id, async (write) => { await write.course.update({ where: { id: a.course.id }, data: { archivedAt: new Date() } }); if (kind === "NOTE") await write.note.update({ where: { id: row.id }, data: { archivedAt: new Date() } }); else await write.resource.update({ where: { id: row.id }, data: { archivedAt: new Date() } }); }); } return result; };
        } });
      } })), options);
    } }) as PrismaClient;
    const snapshot = await queryKnowledge(interleaved, a.owner, kind, { courseId: a.course.id });
    assert.equal(snapshot.length, 1); assert.equal(snapshot[0]!.archivedAt, null);
    assert.equal((await queryKnowledge(prisma, a.owner, kind, { courseId: a.course.id })).length, 0);
  }
});
