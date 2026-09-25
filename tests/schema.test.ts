import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { createPrismaClient } from "../src/db/client.js";
import { withOwnerTransaction } from "../src/db/owner-transaction.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL schema tests");

async function isolated(fn: (db: Client) => Promise<void>): Promise<void> {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query("BEGIN");
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}

async function id(db: Client, sql: string, values: unknown[] = []): Promise<string> {
  const result = await db.query(sql, values);
  assert.equal(result.rows.length, 1);
  return result.rows[0].id as string;
}

async function rejects(db: Client, sql: string, values: unknown[], code: string, constraint?: string): Promise<void> {
  await db.query("SAVEPOINT rejected_write");
  try {
    await assert.rejects(db.query(sql, values), (error: unknown) => {
      assert.equal((error as { code?: string }).code, code);
      if (constraint) assert.equal((error as { constraint?: string }).constraint, constraint);
      return true;
    });
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT rejected_write");
    await db.query("RELEASE SAVEPOINT rejected_write");
  }
}

async function user(db: Client): Promise<string> {
  const owner = await id(db, "INSERT INTO app_user DEFAULT VALUES RETURNING id");
  await db.query("INSERT INTO profile (owner_id, timezone) VALUES ($1, 'Asia/Kuala_Lumpur')", [owner]);
  return owner;
}

async function term(db: Client, owner: string): Promise<string> {
  return id(db, `INSERT INTO term
    (owner_id, name, starts_on, ends_on, teaching_starts_on, academic_timezone)
    VALUES ($1, 'Term', '2026-09-01', '2026-12-31', '2026-09-07', 'Asia/Kuala_Lumpur') RETURNING id`, [owner]);
}

async function course(db: Client, owner: string, termId: string): Promise<string> {
  return id(db, "INSERT INTO course (owner_id, term_id, course_code, title) VALUES ($1,$2,'CS101','Course') RETURNING id", [owner, termId]);
}

async function schedule(db: Client, owner: string, courseId: string, predecessorId?: string): Promise<string> {
  return id(db, `INSERT INTO class_schedule
    (owner_id, course_id, weekday, local_start_time, local_end_time, timezone,
     original_start_date, original_end_date, predecessor_id)
    VALUES ($1,$2,1,'09:00:00','10:00:00','Asia/Kuala_Lumpur','2026-09-07','2026-12-28',$3) RETURNING id`,
  [owner, courseId, predecessorId ?? null]);
}

test("clean replay has the exact critical catalog artifacts", async () => isolated(async (db) => {
  const domainTables = ["app_user","profile","programme","term","course","class_schedule","class_schedule_exception","assignment","task","project","note","resource","event","milestone"];
  const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)", [domainTables]);
  assert.deepEqual(tables.rows.map((row) => row.table_name).sort(), [...domainTables].sort());

  const ownerEdges = [
    "profile_selected_term_id_owner_fk","course_term_id_owner_fk","assignment_course_id_owner_fk",
    "class_schedule_course_id_owner_fk","class_schedule_exception_schedule_id_owner_fk",
    "task_term_id_owner_fk","task_course_id_owner_fk","task_assignment_id_owner_fk","task_project_id_owner_fk",
    "project_course_id_owner_fk","project_home_term_id_owner_fk","note_course_id_owner_fk",
    "resource_course_id_owner_fk","event_term_id_owner_fk","milestone_term_id_owner_fk",
    "schedule_predecessor_context_fk",
  ];
  const checks = [
    "task_deadline_variant_ck","assignment_deadline_variant_ck","project_deadline_variant_ck",
    "task_assignment_context_ck","task_course_context_ck","project_context_ck","event_temporal_variant_ck",
    "schedule_exception_payload_ck","schedule_not_self_predecessor_ck","term_closed_evidence_ck",
    "course_completed_evidence_ck","assignment_grading_evidence_ck","task_completed_evidence_ck",
    "project_completed_evidence_ck","event_cancelled_evidence_ck","resource_http_url_ck",
    "profile_timezone_nonblank_ck","note_title_nonblank_ck",
  ];
  const found = await db.query("SELECT conname, contype FROM pg_constraint WHERE conname=ANY($1)", [[...ownerEdges,...checks]]);
  const byName = new Map(found.rows.map((row) => [row.conname as string,row.contype as string]));
  for (const name of ownerEdges) assert.equal(byName.get(name),"f",name);
  for (const name of checks) assert.equal(byName.get(name),"c",name);

  const triggerNames = [
    ...domainTables.map((table) => `${table}_guard_update`),
    ...["assignment","class_schedule","note","resource","task","project"].map((table) => `${table}_lock_course_context`),
  ];
  const triggers = await db.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1)", [triggerNames]);
  assert.deepEqual(triggers.rows.map((row) => row.tgname).sort(),triggerNames.sort());
  const functions = await db.query("SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1)", [["unios_guard_update","unios_lock_course_context"]]);
  assert.deepEqual(functions.rows.map((row) => row.proname).sort(),["unios_guard_update","unios_lock_course_context"].sort());

  const defaults = await db.query(`SELECT c.relname AS table_name, pg_get_expr(d.adbin,d.adrelid) AS expression
    FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.adnum
    WHERE c.relnamespace='public'::regnamespace AND a.attname='id' AND c.relname=ANY($1)`, [domainTables.filter((table) => table!=="profile")]);
  assert.equal(defaults.rows.length,13);
  for (const row of defaults.rows) assert.match(row.expression,/uuidv7\(\)/,row.table_name);
}));

test("User/Profile provisioning, uniqueness, and UUIDv7", async () => isolated(async (db) => {
  const owner = await user(db);
  assert.equal(owner[14], "7");
  await rejects(db, "INSERT INTO profile (owner_id, timezone) VALUES ($1,'UTC')", [owner], "23505");
  await db.query("INSERT INTO programme (owner_id, name) VALUES ($1,'Computer Science')", [owner]);
  await rejects(db, "INSERT INTO programme (owner_id, name) VALUES ($1,'Another')", [owner], "23505");
  await rejects(db, "UPDATE profile SET owner_id = uuidv7() WHERE owner_id=$1", [owner], "23514");
}));

test("owner-qualified FKs reject cross-account references", async () => isolated(async (db) => {
  const a = await user(db), b = await user(db);
  const bt = await term(db, b), bc = await course(db, b, bt);
  const ba = await id(db, "INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,'A') RETURNING id", [b,bc]);
  const bp = await id(db, "INSERT INTO project (owner_id,title) VALUES ($1,'P') RETURNING id", [b]);
  const bs = await schedule(db,b,bc);
  const cases: [string, unknown[]][] = [
    ["UPDATE profile SET selected_term_id=$2 WHERE owner_id=$1", [a,bt]],
    ["INSERT INTO course (owner_id,term_id,course_code,title) VALUES ($1,$2,'X','X')", [a,bt]],
    ["INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,'X')", [a,bc]],
    ["INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date) VALUES ($1,$2,1,'09:00','10:00','UTC','2026-09-07','2026-12-28')", [a,bc]],
    ["INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind) VALUES ($1,$2,'2026-09-07','CANCEL')", [a,bs]],
    ["INSERT INTO task (owner_id,title,term_id) VALUES ($1,'X',$2)", [a,bt]],
    ["INSERT INTO task (owner_id,title,course_id) VALUES ($1,'X',$2)", [a,bc]],
    ["INSERT INTO task (owner_id,title,assignment_id) VALUES ($1,'X',$2)", [a,ba]],
    ["INSERT INTO task (owner_id,title,project_id) VALUES ($1,'X',$2)", [a,bp]],
    ["INSERT INTO project (owner_id,title,course_id) VALUES ($1,'X',$2)", [a,bc]],
    ["INSERT INTO project (owner_id,title,home_term_id) VALUES ($1,'X',$2)", [a,bt]],
    ["INSERT INTO note (owner_id,title,course_id) VALUES ($1,'X',$2)", [a,bc]],
    ["INSERT INTO resource (owner_id,title,url,course_id) VALUES ($1,'X','https://example.com',$2)", [a,bc]],
    ["INSERT INTO event (owner_id,title,temporal_kind,all_day_starts_on,all_day_ends_on,term_id) VALUES ($1,'X','ALL_DAY','2026-09-07','2026-09-07',$2)", [a,bt]],
    ["INSERT INTO milestone (owner_id,title,occurs_on,term_id) VALUES ($1,'X','2026-09-07',$2)", [a,bt]],
  ];
  for (const [sql, values] of cases) await rejects(db, sql, values, "23503");
}));

test("Task accepted and forbidden local relationship combinations", async () => isolated(async (db) => {
  const owner = await user(db), t = await term(db,owner), c = await course(db,owner,t);
  const a = await id(db,"INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,'A') RETURNING id",[owner,c]);
  const p = await id(db,"INSERT INTO project (owner_id,title) VALUES ($1,'P') RETURNING id",[owner]);
  const accepted = [[null,null,null,null],[t,null,null,null],[null,c,null,null],[null,null,a,null],[null,null,null,p],[t,null,null,p],[null,null,a,p]];
  for (const refs of accepted) await db.query("INSERT INTO task (owner_id,title,term_id,course_id,assignment_id,project_id) VALUES ($1,'T',$2,$3,$4,$5)",[owner,...refs]);
  const forbidden = [[t,c,null,null],[null,c,a,null],[null,c,null,p],[t,null,a,null]];
  for (const refs of forbidden) await rejects(db,"INSERT INTO task (owner_id,title,term_id,course_id,assignment_id,project_id) VALUES ($1,'T',$2,$3,$4,$5)",[owner,...refs],"23514");
}));

test("Task, Assignment and Project deadline variants", async () => isolated(async (db) => {
  const owner = await user(db), t = await term(db,owner), c = await course(db,owner,t);
  for (const table of ["task","assignment","project"]) {
    const base = table === "assignment" ? [owner,c,"X"] : [owner,"X"];
    const columns = table === "assignment" ? "owner_id,course_id,title" : "owner_id,title";
    const placeholders = table === "assignment" ? "$1,$2,$3" : "$1,$2";
    const insert = (kind: string, date: string | null, at: string | null, zone: string | null) =>
      `INSERT INTO ${table} (${columns},deadline_kind,due_date,due_at,due_timezone) VALUES (${placeholders},'${kind}',${date === null ? "NULL" : `'${date}'`},${at === null ? "NULL" : `'${at}'`},${zone === null ? "NULL" : `'${zone}'`})`;
    await db.query(insert("NONE",null,null,null),base);
    await db.query(insert("DATE_ONLY","2026-10-02",null,"Asia/Kuala_Lumpur"),base);
    await db.query(insert("TIMED",null,"2026-10-02T08:00:00Z","Asia/Kuala_Lumpur"),base);
    await rejects(db,insert("NONE","2026-10-02",null,null),base,"23514");
    await rejects(db,insert("DATE_ONLY","2026-10-02",null,null),base,"23514");
    await rejects(db,insert("TIMED","2026-10-02","2026-10-02T08:00:00Z","UTC"),base,"23514");
  }
}));

test("Event temporal variants and Project context", async () => isolated(async (db) => {
  const owner = await user(db), t = await term(db,owner), c = await course(db,owner,t);
  await db.query("INSERT INTO event (owner_id,title,temporal_kind,all_day_starts_on,all_day_ends_on) VALUES ($1,'E','ALL_DAY','2026-10-02','2026-10-03')",[owner]);
  await db.query("INSERT INTO event (owner_id,title,temporal_kind,starts_at,ends_at,interpretation_timezone) VALUES ($1,'E','TIMED','2026-10-02T08:00Z','2026-10-02T09:00Z','Asia/Kuala_Lumpur')",[owner]);
  await rejects(db,"INSERT INTO event (owner_id,title,temporal_kind,all_day_starts_on) VALUES ($1,'E','ALL_DAY','2026-10-02')",[owner],"23514");
  await rejects(db,"INSERT INTO event (owner_id,title,temporal_kind,starts_at,ends_at,interpretation_timezone) VALUES ($1,'E','TIMED','2026-10-02T08:00Z','2026-10-02T08:00Z','UTC')",[owner],"23514");
  await rejects(db,"INSERT INTO event (owner_id,title,temporal_kind,all_day_starts_on,all_day_ends_on,starts_at) VALUES ($1,'E','ALL_DAY','2026-10-02','2026-10-02','2026-10-02T08:00Z')",[owner],"23514");
  await db.query("INSERT INTO project (owner_id,title,course_id) VALUES ($1,'P',$2)",[owner,c]);
  await db.query("INSERT INTO project (owner_id,title,home_term_id) VALUES ($1,'P',$2)",[owner,t]);
  await rejects(db,"INSERT INTO project (owner_id,title,course_id,home_term_id) VALUES ($1,'P',$2,$3)",[owner,c,t],"23514");
}));

test("terminal lifecycle evidence is required and retained after reopening", async () => isolated(async (db) => {
  const owner = await user(db), t = await term(db,owner), c = await course(db,owner,t);
  const a = await id(db,"INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,'A') RETURNING id",[owner,c]);
  const task = await id(db,"INSERT INTO task (owner_id,course_id,title) VALUES ($1,$2,'T') RETURNING id",[owner,c]);
  const p = await id(db,"INSERT INTO project (owner_id,title) VALUES ($1,'P') RETURNING id",[owner]);
  const e = await id(db,"INSERT INTO event (owner_id,title,temporal_kind,all_day_starts_on,all_day_ends_on) VALUES ($1,'E','ALL_DAY','2026-10-02','2026-10-02') RETURNING id",[owner]);
  const cases: [string,string,string,string][] = [
    ["term",t,"CLOSED","last_closed_at"],
    ["course",c,"COMPLETED","last_completed_at"],
    ["assignment",a,"SUBMITTED","last_submitted_at"],
    ["task",task,"DONE","last_completed_at"],
    ["project",p,"COMPLETED","last_completed_at"],
    ["event",e,"CANCELLED","last_cancelled_at"],
  ];
  for (const [table, record, terminal, evidence] of cases) {
    await rejects(db,`UPDATE ${table} SET status='${terminal}' WHERE id=$1`,[record],"23514");
    await db.query(`UPDATE ${table} SET status='${terminal}', ${evidence}='2026-10-02T08:00:00Z' WHERE id=$1`,[record]);
    const reopened = {term:"PLANNED",course:"UPCOMING",assignment:"NOT_STARTED",task:"TODO",project:"PLANNED",event:"SCHEDULED"}[table];
    await db.query(`UPDATE ${table} SET status='${reopened}' WHERE id=$1`,[record]);
    await rejects(db,`UPDATE ${table} SET ${evidence}=NULL WHERE id=$1`,[record],"23514");
    await rejects(db,`UPDATE ${table} SET ${evidence}='2026-10-01T08:00:00Z' WHERE id=$1`,[record],"23514");
    const result=await db.query(`SELECT ${evidence} IS NOT NULL AS retained FROM ${table} WHERE id=$1`,[record]);
    assert.equal(result.rows[0].retained,true);
  }
}));

test("every evidence-requiring current lifecycle state rejects missing evidence", async () => isolated(async (db) => {
  const owner=await user(db), t=await term(db,owner), c=await course(db,owner,t);
  const a=await id(db,"INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,'A') RETURNING id",[owner,c]);
  const task=await id(db,"INSERT INTO task (owner_id,title) VALUES ($1,'T') RETURNING id",[owner]);
  const project=await id(db,"INSERT INTO project (owner_id,title) VALUES ($1,'P') RETURNING id",[owner]);
  const event=await id(db,"INSERT INTO event (owner_id,title,temporal_kind,all_day_starts_on,all_day_ends_on) VALUES ($1,'E','ALL_DAY','2026-09-25','2026-09-25') RETURNING id",[owner]);
  const cases:[string,string,string][]=[
    ["UPDATE term SET status='ACTIVE' WHERE id=$1",t,"term_active_evidence_ck"],
    ["UPDATE term SET status='CLOSED' WHERE id=$1",t,"term_closed_evidence_ck"],
    ["UPDATE course SET status='ACTIVE' WHERE id=$1",c,"course_active_evidence_ck"],
    ["UPDATE course SET status='COMPLETED' WHERE id=$1",c,"course_completed_evidence_ck"],
    ["UPDATE course SET status='CANCELLED' WHERE id=$1",c,"course_cancelled_evidence_ck"],
    ["UPDATE assignment SET status='SUBMITTED' WHERE id=$1",a,"assignment_submission_evidence_ck"],
    ["UPDATE assignment SET status='GRADED', last_submitted_at=now() WHERE id=$1",a,"assignment_grading_evidence_ck"],
    ["UPDATE assignment SET status='CANCELLED' WHERE id=$1",a,"assignment_cancelled_evidence_ck"],
    ["UPDATE task SET status='DONE' WHERE id=$1",task,"task_completed_evidence_ck"],
    ["UPDATE task SET status='CANCELLED' WHERE id=$1",task,"task_cancelled_evidence_ck"],
    ["UPDATE project SET status='ACTIVE' WHERE id=$1",project,"project_active_evidence_ck"],
    ["UPDATE project SET status='COMPLETED' WHERE id=$1",project,"project_completed_evidence_ck"],
    ["UPDATE project SET status='CANCELLED' WHERE id=$1",project,"project_cancelled_evidence_ck"],
    ["UPDATE event SET status='CANCELLED' WHERE id=$1",event,"event_cancelled_evidence_ck"],
  ];
  for(const [sql,record,constraint] of cases) await rejects(db,sql,[record],"23514",constraint);
}));

test("archive is independent of lifecycle and deletion is restrictive", async () => isolated(async (db) => {
  const owner = await user(db), t = await term(db,owner), c = await course(db,owner,t);
  const task = await id(db,"INSERT INTO task (owner_id,course_id,title) VALUES ($1,$2,'T') RETURNING id",[owner,c]);
  const a = await id(db,"INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,'A') RETURNING id",[owner,c]);
  await rejects(db,"UPDATE task SET archived_at=now() WHERE id=$1",[task],"23514");
  await rejects(db,"UPDATE assignment SET archived_at=now() WHERE id=$1",[a],"23514");
  await db.query("UPDATE course SET archived_at=now() WHERE id=$1",[c]);
  const archived=await db.query("SELECT status, archived_at IS NOT NULL AS archived FROM course WHERE id=$1",[c]);
  assert.deepEqual(archived.rows[0],{status:"UPCOMING",archived:true});
  const children=await db.query("SELECT 'assignment' AS kind,status::text,archived_at,course_id FROM assignment WHERE id=$1 UNION ALL SELECT 'task',status::text,archived_at,course_id FROM task WHERE id=$2",[a,task]);
  assert.deepEqual(children.rows.map((row)=>[row.kind,row.status,row.archived_at,row.course_id]),[
    ["assignment","NOT_STARTED",null,c],["task","TODO",null,c],
  ]);
  await db.query("UPDATE term SET archived_at=now() WHERE id=$1",[t]);
  const termAfter=await db.query("SELECT status,archived_at IS NOT NULL AS archived FROM term WHERE id=$1",[t]);
  assert.deepEqual(termAfter.rows[0],{status:"PLANNED",archived:true});
  assert.equal((await db.query("SELECT term_id FROM course WHERE id=$1",[c])).rows[0].term_id,t);
  await rejects(db,"DELETE FROM term WHERE id=$1",[t],"23001");
  await rejects(db,"DELETE FROM course WHERE id=$1",[c],"23001");
  await rejects(db,"DELETE FROM app_user WHERE id=$1",[owner],"23001");
  const selected=await term(db,owner);
  await db.query("UPDATE profile SET selected_term_id=$2 WHERE owner_id=$1",[owner,selected]);
  await rejects(db,"DELETE FROM term WHERE id=$1",[selected],"23001");
  await db.query("UPDATE profile SET selected_term_id=NULL WHERE owner_id=$1",[owner]);
  await db.query("DELETE FROM term WHERE id=$1",[selected]);
}));

test("every approved attachment permanently locks Course Term", async () => isolated(async (db) => {
  const owner = await user(db), firstTerm = await term(db,owner), nextTerm = await term(db,owner);
  const attachments: [string,(courseId:string)=>unknown[]][] = [
    ["assignment", c => [owner,c,"A"]],
    ["class_schedule", c => [owner,c]],
    ["note", c => [owner,c,"N"]],
    ["resource", c => [owner,c,"R","https://example.com"]],
    ["task", c => [owner,c,"T"]],
    ["project", c => [owner,c,"P"]],
  ];
  const sql: Record<string,string> = {
    assignment:"INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,$3) RETURNING id",
    class_schedule:"INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date) VALUES ($1,$2,1,'09:00','10:00','UTC','2026-09-07','2026-12-28') RETURNING id",
    note:"INSERT INTO note (owner_id,course_id,title) VALUES ($1,$2,$3) RETURNING id",
    resource:"INSERT INTO resource (owner_id,course_id,title,url) VALUES ($1,$2,$3,$4) RETURNING id",
    task:"INSERT INTO task (owner_id,course_id,title) VALUES ($1,$2,$3) RETURNING id",
    project:"INSERT INTO project (owner_id,course_id,title) VALUES ($1,$2,$3) RETURNING id",
  };
  for (const [table, params] of attachments) {
    const c=await course(db,owner,firstTerm);
    const child=await id(db,sql[table]!,params(c));
    const result=await db.query("SELECT first_dependant_at IS NOT NULL AS locked FROM course WHERE id=$1",[c]);
    assert.equal(result.rows[0].locked,true,table);
    await db.query(`DELETE FROM ${table} WHERE id=$1`,[child]);
    await rejects(db,"UPDATE course SET term_id=$2 WHERE id=$1",[c,nextTerm],"23514");
    await rejects(db,"UPDATE course SET first_dependant_at=NULL WHERE id=$1",[c],"23514");
  }
}));

test("mutable Course reassignments lock destination and never unlock source",async()=>isolated(async(db)=>{
  const owner=await user(db), t1=await term(db,owner), t2=await term(db,owner);
  const cases:[string,string,(source:string)=>unknown[]][]=[
    ["assignment","INSERT INTO assignment (owner_id,course_id,title) VALUES ($1,$2,'A') RETURNING id",c=>[owner,c]],
    ["note","INSERT INTO note (owner_id,course_id,title) VALUES ($1,$2,'N') RETURNING id",c=>[owner,c]],
    ["resource","INSERT INTO resource (owner_id,course_id,title,url) VALUES ($1,$2,'R','https://example.com') RETURNING id",c=>[owner,c]],
    ["task","INSERT INTO task (owner_id,course_id,title) VALUES ($1,$2,'T') RETURNING id",c=>[owner,c]],
    ["project","INSERT INTO project (owner_id,course_id,title) VALUES ($1,$2,'P') RETURNING id",c=>[owner,c]],
  ];
  for(const [table,insert,params] of cases){
    const source=await course(db,owner,t1),destination=await course(db,owner,t1);
    const child=await id(db,insert,params(source));
    await db.query(`UPDATE ${table} SET course_id=$2 WHERE id=$1`,[child,destination]);
    const locks=await db.query("SELECT id,first_dependant_at IS NOT NULL AS locked FROM course WHERE id=ANY($1)",[[source,destination]]);
    assert.equal(locks.rows.length,2);
    for(const row of locks.rows) assert.equal(row.locked,true,`${table}: ${row.id}`);
    await db.query(`DELETE FROM ${table} WHERE id=$1`,[child]);
    await rejects(db,"UPDATE course SET term_id=$2 WHERE id=$1",[source,t2],"23514");
    await rejects(db,"UPDATE course SET term_id=$2 WHERE id=$1",[destination,t2],"23514");
  }
  const source=await course(db,owner,t1),destination=await course(db,owner,t1);
  const immutableSchedule=await schedule(db,owner,source);
  await rejects(db,"UPDATE class_schedule SET course_id=$2 WHERE id=$1",[immutableSchedule,destination],"23514");
}));

test("recurrence exception identity, predecessor context and successor uniqueness", async () => isolated(async (db) => {
  const owner = await user(db), other=await user(db), t = await term(db,owner), c = await course(db,owner,t), c2=await course(db,owner,t);
  const ot=await term(db,other), oc=await course(db,other,ot);
  const root=await schedule(db,owner,c);
  const exception=await id(db,"INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind) VALUES ($1,$2,'2026-09-07','CANCEL') RETURNING id",[owner,root]);
  await rejects(db,"INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind) VALUES ($1,$2,'2026-09-07','CANCEL')",[owner,root],"23505");
  await rejects(db,"UPDATE class_schedule_exception SET original_date='2026-09-14' WHERE id=$1",[exception],"23514");
  await rejects(db,"UPDATE class_schedule SET original_start_date='2026-09-14' WHERE id=$1",[root],"23514");
  await rejects(db,"INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date,predecessor_id) VALUES ($1,$2,1,'09:00','10:00','UTC','2026-09-07','2026-12-28',$3)",[owner,c2,root],"23503");
  const otherRoot=await schedule(db,other,oc);
  await rejects(db,"INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date,predecessor_id) VALUES ($1,$2,1,'09:00','10:00','UTC','2026-09-07','2026-12-28',$3)",[owner,c,otherRoot],"23503");
  await schedule(db,owner,c,root);
  await rejects(db,"INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date,predecessor_id) VALUES ($1,$2,1,'09:00','10:00','UTC','2026-09-07','2026-12-28',$3)",[owner,c,root],"23505");
  const self=(await db.query("SELECT uuidv7() AS id")).rows[0].id as string;
  await rejects(db,"INSERT INTO class_schedule (id,owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date,predecessor_id) VALUES ($1,$2,$3,1,'09:00','10:00','UTC','2026-09-07','2026-12-28',$1)",[self,owner,c],"23514");
}));

test("metadata, recurrence identity, and retirement guards enforce each branch",async()=>isolated(async(db)=>{
  const owner=await user(db),other=await user(db),t=await term(db,owner),c=await course(db,owner,t),c2=await course(db,owner,t);
  const task=await id(db,"INSERT INTO task (owner_id,title) VALUES ($1,'Guard') RETURNING id",[owner]);
  await rejects(db,"UPDATE task SET owner_id=$2 WHERE id=$1",[task,other],"23514");
  await rejects(db,"UPDATE task SET id=uuidv7() WHERE id=$1",[task],"23514");
  await rejects(db,"UPDATE task SET created_at='2001-01-01T00:00Z' WHERE id=$1",[task],"23514");
  await db.query("UPDATE task SET title='Changed', updated_at='2001-01-01T00:00Z' WHERE id=$1",[task]);
  const stamped=await db.query("SELECT updated_at > '2020-01-01T00:00Z'::timestamptz AS refreshed FROM task WHERE id=$1",[task]);
  assert.equal(stamped.rows[0].refreshed,true);
  const s=await schedule(db,owner,c),otherSchedule=await schedule(db,owner,c2);
  const changes:[string,unknown][]=[
    ["course_id",c2],["weekday",2],["local_start_time","08:00"],["local_end_time","11:00"],
    ["end_day_offset",1],["timezone","UTC"],["original_start_date","2026-09-14"],
    ["original_end_date","2026-12-21"],["location","Room"],["predecessor_id",otherSchedule],
  ];
  for(const [field,value] of changes) await rejects(db,`UPDATE class_schedule SET ${field}=$2 WHERE id=$1`,[s,value],"23514");
  const occurrence=await id(db,"INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind) VALUES ($1,$2,'2026-09-07','CANCEL') RETURNING id",[owner,s]);
  await rejects(db,"UPDATE class_schedule_exception SET schedule_id=$2 WHERE id=$1",[occurrence,otherSchedule],"23514");
  await rejects(db,"UPDATE class_schedule_exception SET original_date='2026-09-14' WHERE id=$1",[occurrence],"23514");
  await db.query("UPDATE class_schedule SET retired_from_date='2026-10-05' WHERE id=$1",[s]);
  await rejects(db,"UPDATE class_schedule SET retired_from_date=NULL WHERE id=$1",[s],"23514");
  await rejects(db,"UPDATE class_schedule SET retired_from_date='2026-10-12' WHERE id=$1",[s],"23514");
  await db.query("UPDATE class_schedule SET retired_from_date='2026-09-28' WHERE id=$1",[s]);
  assert.equal((await db.query("SELECT retired_from_date::text AS d FROM class_schedule WHERE id=$1",[s])).rows[0].d,"2026-09-28");
}));

test("repeated Course codes and literal date, local time, timezone round trips", async () => isolated(async (db) => {
  const owner=await user(db), t=await term(db,owner), c=await course(db,owner,t);
  await course(db,owner,t);
  const s=await schedule(db,owner,c);
  const task=await id(db,"INSERT INTO task (owner_id,title,deadline_kind,due_at,due_timezone) VALUES ($1,'Timed','TIMED','2026-10-02T08:00:00Z','Asia/Kuala_Lumpur') RETURNING id",[owner]);
  for (const zone of ["Asia/Kuala_Lumpur","America/New_York"]) {
    await db.query(`SET LOCAL TIME ZONE '${zone}'`);
    const dates=await db.query("SELECT starts_on::text AS d FROM term WHERE id=$1",[t]);
    const times=await db.query("SELECT local_start_time::text AS start, local_end_time::text AS finish FROM class_schedule WHERE id=$1",[s]);
    const instant=await db.query("SELECT extract(epoch FROM due_at)::bigint AS epoch, due_timezone FROM task WHERE id=$1",[task]);
    assert.equal(dates.rows[0].d,"2026-09-01");
    assert.deepEqual(times.rows[0],{start:"09:00:00",finish:"10:00:00"});
    assert.equal(Number(instant.rows[0].epoch),Date.parse("2026-10-02T08:00:00Z")/1000);
    assert.equal(instant.rows[0].due_timezone,"Asia/Kuala_Lumpur");
  }
}));

test("schedule bounds, exception payload, finite dates, labels and URL checks", async () => isolated(async (db) => {
  const owner=await user(db), t=await term(db,owner), c=await course(db,owner,t);
  await rejects(db,"UPDATE term SET ends_on='infinity' WHERE id=$1",[t],"23514","term_ends_on_finite_ck");
  const timed=await id(db,"INSERT INTO task (owner_id,title,deadline_kind,due_at,due_timezone) VALUES ($1,'Timed','TIMED','2026-10-02T08:00Z','UTC') RETURNING id",[owner]);
  await rejects(db,"UPDATE task SET due_at='infinity' WHERE id=$1",[timed],"23514","task_due_at_finite_ck");
  await rejects(db,"INSERT INTO note (owner_id,title) VALUES ($1,'   ')",[owner],"23514");
  await rejects(db,"INSERT INTO resource (owner_id,title,url) VALUES ($1,'R','file:///tmp/x')",[owner],"23514");
  await rejects(db,"INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date) VALUES ($1,$2,8,'09:00','10:00','UTC','2026-09-07','2026-12-28')",[owner,c],"23514");
  await rejects(db,"INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date) VALUES ($1,$2,1,'09:00','09:00','UTC','2026-09-07','2026-12-28')",[owner,c],"23514");
  const overnight=await id(db,"INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,end_day_offset,timezone,original_start_date,original_end_date) VALUES ($1,$2,1,'23:00','01:00',1,'UTC','2026-09-07','2026-12-28') RETURNING id",[owner,c]);
  await rejects(db,"INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind,replacement_starts_at) VALUES ($1,$2,'2026-09-07','CANCEL','2026-09-08T01:00Z')",[owner,overnight],"23514");
  await rejects(db,"INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind) VALUES ($1,$2,'2026-09-07','MOVE')",[owner,overnight],"23514");
  await db.query("INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind,replacement_starts_at,replacement_ends_at,replacement_timezone) VALUES ($1,$2,'2026-09-07','MOVE','2026-09-08T01:00Z','2026-09-08T02:00Z','UTC')",[owner,overnight]);
}));

test("Prisma transaction helper locks the authenticated User row", async () => {
  const db=new Client({connectionString});
  const prisma=createPrismaClient(connectionString);
  await db.connect();
  let owner: string | undefined;
  try {
    owner=await id(db,"INSERT INTO app_user DEFAULT VALUES RETURNING id");
    await db.query("INSERT INTO profile (owner_id,timezone) VALUES ($1,'UTC')",[owner]);
    const value=await withOwnerTransaction(prisma,owner,async tx => {
      const rows=await tx.$queryRaw<{ id:string }[]>`SELECT id FROM public.app_user WHERE id=${owner}::uuid`;
      return rows[0]?.id;
    });
    assert.equal(value,owner);
    await assert.rejects(withOwnerTransaction(prisma,"00000000-0000-7000-8000-000000000000",async () => "unreachable"));
  } finally {
    if (owner) {
      await db.query("DELETE FROM profile WHERE owner_id=$1",[owner]);
      await db.query("DELETE FROM app_user WHERE id=$1",[owner]);
    }
    await prisma.$disconnect();
    await db.end();
  }
});

test("owner gate serializes peers, isolates accounts, commits visibility and rolls back", async () => {
  const prisma=createPrismaClient(connectionString);
  let release: () => void = () => {};
  let first: Promise<unknown> | undefined;
  let waiter: Promise<unknown> | undefined;
  try {
    const a=await prisma.user.create({data:{profile:{create:{timezone:"UTC",displayName:"initial"}}}});
    const b=await prisma.user.create({data:{profile:{create:{timezone:"UTC",displayName:"other initial"}}}});
    const hold=new Promise<void>((resolve)=>{release=resolve});
    let markAcquired: () => void = () => {};
    const acquired=new Promise<void>((resolve)=>{markAcquired=resolve});
    let expiredQuery: (()=>Promise<unknown>) | undefined;
    first=withOwnerTransaction(prisma,a.id,async tx=>{
      await tx.profile.update({where:{ownerId:a.id},data:{displayName:"first committed"}});
      expiredQuery=()=>tx.profile.findUnique({where:{ownerId:a.id}});
      markAcquired();
      await hold;
    });
    await acquired;
    let waiterEntered=false;
    let observed: string | null | undefined;
    waiter=withOwnerTransaction(prisma,a.id,async tx=>{
      waiterEntered=true;
      observed=(await tx.profile.findUniqueOrThrow({where:{ownerId:a.id}})).displayName;
      await tx.profile.update({where:{ownerId:a.id},data:{displayName:"second committed"}});
    });
    await new Promise((resolve)=>setTimeout(resolve,150));
    assert.equal(waiterEntered,false,"same-owner callback entered before first transaction committed");
    await withOwnerTransaction(prisma,b.id,async tx=>{
      await tx.profile.update({where:{ownerId:b.id},data:{displayName:"other committed"}});
    });
    assert.equal((await prisma.profile.findUniqueOrThrow({where:{ownerId:b.id}})).displayName,"other committed");
    assert.equal(waiterEntered,false,"different-owner work should finish while same-owner waits");
    release();
    await first;
    await waiter;
    assert.equal(observed,"first committed","waiter did not see committed predecessor write");
    assert.equal((await prisma.profile.findUniqueOrThrow({where:{ownerId:a.id}})).displayName,"second committed");
    assert.ok(expiredQuery);
    await assert.rejects(expiredQuery());
    await assert.rejects(withOwnerTransaction(prisma,a.id,async tx=>{
      await tx.profile.update({where:{ownerId:a.id},data:{displayName:"rolled back"}});
      throw new Error("intentional rollback");
    }),/intentional rollback/);
    assert.equal((await prisma.profile.findUniqueOrThrow({where:{ownerId:a.id}})).displayName,"second committed");
  } finally {
    release();
    await Promise.allSettled([first,waiter].filter((value)=>value!==undefined));
    await prisma.$disconnect();
  }
});
