import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";

const url=process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const blanks=[""," ","\t","\n","\r\n"," \t\n \r\n"];

test("every nonblank category rejects PostgreSQL whitespace without altering valid text",async()=>{
  const db=new Client({connectionString:url});
  await db.connect();
  let savepoint=0;
  async function expectConstraint(sql:string,values:unknown[],names:string|string[]):Promise<void>{
    const label=`nonblank_${++savepoint}`;
    await db.query(`SAVEPOINT ${label}`);
    try{
      await assert.rejects(db.query(sql,values),(error:unknown)=>{
        const actual=(error as {code?:string;constraint?:string});
        assert.equal(actual.code,"23514");
        assert.ok([names].flat().includes(actual.constraint ?? ""),`wrong constraint for ${sql}: ${actual.constraint}`);
        return true;
      });
    }finally{
      await db.query(`ROLLBACK TO SAVEPOINT ${label}`);
      await db.query(`RELEASE SAVEPOINT ${label}`);
    }
  }
  async function id(sql:string,values:unknown[]=[]):Promise<string>{
    const result=await db.query(sql,values);
    return result.rows[0].id as string;
  }
  await db.query("BEGIN");
  try{
    const owner=await id("INSERT INTO app_user DEFAULT VALUES RETURNING id");
    await db.query("INSERT INTO profile (owner_id,timezone) VALUES ($1,'UTC')",[owner]);
    const programme=await id("INSERT INTO programme (owner_id,name) VALUES ($1,'Programme') RETURNING id",[owner]);
    const term=await id("INSERT INTO term (owner_id,name,starts_on,ends_on,teaching_starts_on,academic_timezone) VALUES ($1,'Term','2026-09-01','2026-12-31','2026-09-07','UTC') RETURNING id",[owner]);
    const course=await id("INSERT INTO course (owner_id,term_id,course_code,title) VALUES ($1,$2,'CS101','Course') RETURNING id",[owner,term]);
    const schedule=await id("INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,original_start_date,original_end_date) VALUES ($1,$2,1,'09:00','10:00','UTC','2026-09-07','2026-12-28') RETURNING id",[owner,course]);
    const exception=await id("INSERT INTO class_schedule_exception (owner_id,schedule_id,original_date,kind,replacement_starts_at,replacement_ends_at,replacement_timezone) VALUES ($1,$2,'2026-09-07','MOVE','2026-09-08T09:00Z','2026-09-08T10:00Z','UTC') RETURNING id",[owner,schedule]);
    const assignment=await id("INSERT INTO assignment (owner_id,course_id,title,deadline_kind,due_date,due_timezone) VALUES ($1,$2,'Assignment','DATE_ONLY','2026-10-02','UTC') RETURNING id",[owner,course]);
    const task=await id("INSERT INTO task (owner_id,title,deadline_kind,due_date,due_timezone) VALUES ($1,'Task','DATE_ONLY','2026-10-02','UTC') RETURNING id",[owner]);
    const project=await id("INSERT INTO project (owner_id,title,deadline_kind,due_date,due_timezone) VALUES ($1,'Project','DATE_ONLY','2026-10-02','UTC') RETURNING id",[owner]);
    const note=await id("INSERT INTO note (owner_id,title) VALUES ($1,'Note') RETURNING id",[owner]);
    const resource=await id("INSERT INTO resource (owner_id,title,url) VALUES ($1,'Resource','https://example.com') RETURNING id",[owner]);
    const event=await id("INSERT INTO event (owner_id,title,temporal_kind,starts_at,ends_at,interpretation_timezone) VALUES ($1,'Event','TIMED','2026-09-25T09:00Z','2026-09-25T10:00Z','UTC') RETURNING id",[owner]);
    const milestone=await id("INSERT INTO milestone (owner_id,title,occurs_on) VALUES ($1,'Milestone','2026-09-25') RETURNING id",[owner]);

    const generic:[string,string,string,string][]=[
      ["profile","owner_id",owner,"timezone"],["profile","owner_id",owner,"display_name"],
      ["programme","id",programme,"name"],["term","id",term,"name"],["term","id",term,"academic_timezone"],
      ["course","id",course,"course_code"],["course","id",course,"title"],
      ["class_schedule_exception","id",exception,"replacement_location"],
      ["assignment","id",assignment,"title"],["task","id",task,"title"],["project","id",project,"title"],
      ["note","id",note,"title"],["resource","id",resource,"title"],["event","id",event,"title"],
      ["milestone","id",milestone,"title"],
    ];
    for(const [table,key,record,column] of generic){
      for(const blank of blanks) await expectConstraint(`UPDATE ${table} SET ${column}=$2 WHERE ${key}=$1`,[record,blank],`${table}_${column}_nonblank_ck`);
      const meaningful=" \tA\n";
      await db.query(`UPDATE ${table} SET ${column}=$2 WHERE ${key}=$1`,[record,meaningful]);
      const saved=await db.query(`SELECT ${column} AS value FROM ${table} WHERE ${key}=$1`,[record]);
      assert.equal(saved.rows[0].value,meaningful);
    }
    for(const blank of blanks){
      const insertSchedule="INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,location,original_start_date,original_end_date) VALUES ($1,$2,1,'09:00','10:00',$3,$4,'2026-09-07','2026-12-28')";
      await expectConstraint(insertSchedule,[owner,course,blank,"Room"],"class_schedule_timezone_nonblank_ck");
      await expectConstraint(insertSchedule,[owner,course,"UTC",blank],"class_schedule_location_nonblank_ck");
    }
    const meaningfulSchedule=" \tA\n";
    const scheduleWithText=await id("INSERT INTO class_schedule (owner_id,course_id,weekday,local_start_time,local_end_time,timezone,location,original_start_date,original_end_date) VALUES ($1,$2,1,'09:00','10:00',$3,$3,'2026-09-07','2026-12-28') RETURNING id",[owner,course,meaningfulSchedule]);
    const savedSchedule=await db.query("SELECT timezone,location FROM class_schedule WHERE id=$1",[scheduleWithText]);
    assert.deepEqual(savedSchedule.rows[0],{timezone:meaningfulSchedule,location:meaningfulSchedule});
    for(const [table,record] of [["assignment",assignment],["task",task],["project",project]] as const){
      for(const blank of blanks) await expectConstraint(`UPDATE ${table} SET due_timezone=$2 WHERE id=$1`,[record,blank],[`${table}_deadline_variant_ck`,`${table}_due_timezone_nonblank_ck`]);
      await db.query(`UPDATE ${table} SET due_timezone=$2 WHERE id=$1`,[record," \tUTC\n"]);
      assert.equal((await db.query(`SELECT due_timezone FROM ${table} WHERE id=$1`,[record])).rows[0].due_timezone," \tUTC\n");
    }
    for(const blank of blanks){
      await expectConstraint("UPDATE event SET interpretation_timezone=$2 WHERE id=$1",[event,blank],["event_temporal_variant_ck","event_interpretation_timezone_nonblank_ck"]);
      await expectConstraint("UPDATE class_schedule_exception SET replacement_timezone=$2 WHERE id=$1",[exception,blank],["schedule_exception_payload_ck","class_schedule_exception_replacement_timezone_nonblank_ck"]);
      await expectConstraint("UPDATE resource SET url=$2 WHERE id=$1",[resource,blank],"resource_http_url_ck");
    }
    await db.query("UPDATE event SET interpretation_timezone=$2 WHERE id=$1",[event," \tUTC\n"]);
    await db.query("UPDATE class_schedule_exception SET replacement_timezone=$2 WHERE id=$1",[exception," \tUTC\n"]);
    assert.equal((await db.query("SELECT interpretation_timezone FROM event WHERE id=$1",[event])).rows[0].interpretation_timezone," \tUTC\n");
    assert.equal((await db.query("SELECT replacement_timezone FROM class_schedule_exception WHERE id=$1",[exception])).rows[0].replacement_timezone," \tUTC\n");
    await db.query("UPDATE profile SET display_name=NULL WHERE owner_id=$1",[owner]);
    await db.query("UPDATE class_schedule_exception SET replacement_location=NULL WHERE id=$1",[exception]);
    assert.equal((await db.query("SELECT display_name FROM profile WHERE owner_id=$1",[owner])).rows[0].display_name,null);
    assert.equal((await db.query("SELECT replacement_location FROM class_schedule_exception WHERE id=$1",[exception])).rows[0].replacement_location,null);
    await db.query("UPDATE resource SET url='https://example.com/path' WHERE id=$1",[resource]);
    assert.equal((await db.query("SELECT url FROM resource WHERE id=$1",[resource])).rows[0].url,"https://example.com/path");
  }finally{
    await db.query("ROLLBACK");
    await db.end();
  }
});
