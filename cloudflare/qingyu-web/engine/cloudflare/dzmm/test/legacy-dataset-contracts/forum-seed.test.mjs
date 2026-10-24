import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { tsImport } from 'tsx/esm/api';
import { unstable_splitSqlQuery } from 'wrangler';
import { splitSqlStatements } from './sql-migrations.mjs';
import { buildForumSeedPackage, validateForumSeed } from '../scripts/prepare-forum-demo-seed.mjs';

const { fetchRequest } = await tsImport('../src/app.ts', import.meta.url);
const raw = await readFile(new URL('../../../output/xumeng/forum-seed-20261009/forum-seed.sealed.json', import.meta.url),'utf8');
const hash = createHash('sha256').update(raw).digest('hex'), manifest = JSON.parse(raw), pack = buildForumSeedPackage(raw,hash);
const origin='https://forum-seed.example.test', batch=manifest.batchId;
test('installed Wrangler local migration CLI applies0029 with a CASE-free rollback guard',async t=>{
  const sql=await readFile(new URL('../migrations/0029_forum_demo_seed.sql',import.meta.url),'utf8');
  const queries=unstable_splitSqlQuery(sql), isolated=splitSqlStatements(sql);
  assert.equal(queries.length,isolated.length);
  const rollback=queries.find(value=>value.includes('CREATE TRIGGER forum_demo_batch_remove'));
  assert.ok(rollback); assert.doesNotMatch(rollback,/SELECT\s+CASE\s+WHEN/i);
  assert.match(rollback,/SELECT RAISE\(ABORT,'Demo rollback refused:[^']+'\) WHERE/);
  assert.match(rollback,/DELETE FROM forum_demo_seed_chunks WHERE batch_id=OLD\.id;\s*END$/);
  const folder=await mkdtemp(join(tmpdir(),'qingyu-forum-cli-')); t.after(()=>rm(folder,{recursive:true,force:true}));
  const config=join(folder,'wrangler.json'), persist=join(folder,'local-only');
  await writeFile(config,JSON.stringify({name:'isolated-forum-seed-migration',compatibility_date:'2026-10-01',d1_databases:[{binding:'DB',database_name:'isolated-forum-seed',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:fileURLToPath(new URL('../migrations/',import.meta.url))}]}));
  const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
  const run=async args=>promisify(execFile)(process.execPath,[cli,...args,'--local','--persist-to',persist,'--config',config],{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},timeout:30000,maxBuffer:4*1024*1024});
  await run(['d1','migrations','apply','DB']);
  const result=await run(['d1','execute','DB','--command',"SELECT (SELECT COUNT(*) FROM d1_migrations WHERE name='0029_forum_demo_seed.sql') AS applied, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'forum_demo_%') AS guards, (SELECT COUNT(*) FROM users WHERE is_demo=1) AS demo_authors;",'--json']);
  const rows=JSON.parse(result.stdout); assert.deepEqual(rows[0].results,[{applied:1,guards:31,demo_authors:0}]);
});
async function fixture(t) {
  const store=new Miniflare(convertV4MiniflareOptions({ compatibilityDate:'2026-10-01',modules:true,script:'export default {fetch(){return new Response("isolated seed")}}',d1Databases:{DB:randomUUID()} }));
  t.after(()=>store.dispose()); const DB=await store.getD1Database('DB');
  for (const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()) {
    const sql=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'); await DB.batch(splitSqlStatements(sql).map(part=>DB.prepare(part)));
  }
  const env={DB,APP_ORIGINS:origin};
  async function api(path,actor,body,method=body===undefined?'GET':'POST') {
    const response=await fetchRequest(new Request(origin+path,{method,headers:{Origin:origin,...(actor?{Cookie:`qingyu_session=${actor.token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
    return {status:response.status,data:await response.json()};
  }
  async function account(role='user') {
    const id=randomUUID(),token=randomBytes(32).toString('hex'),now=Date.now(),nickname='原创隔离账户';
    await DB.batch([DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,?,?)').bind(id,nickname,role,now),
      DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),id,now+86400000,now)]);
    return {id,token,nickname};
  }
  const stage=()=>DB.batch(splitSqlStatements(pack.stageSql).map(sql=>DB.prepare(sql)));
  const commit=()=>DB.prepare(pack.commitSql).run();
  const counts=()=>DB.prepare(pack.countSql).first();
  const seed=async()=>{await stage();await commit();};
  return {DB,api,account,stage,commit,counts,seed};
}
test('sealed compiler rejects wrong hashes, fabricated counters, missing disclosure and broken references',()=>{
  assert.ok(pack.report.maxStatementBytes<100000); assert.equal(pack.report.networkCalls,0); assert.equal(pack.report.databaseWrites,false);
  assert.throws(()=>buildForumSeedPackage(raw,'0'.repeat(64)),/SHA256/);
  for (const mutate of [value=>{value.posts[0].upvotes=20;},value=>{value.posts[0].category='real';},value=>{value.profiles[0].isDemo=false;},
    value=>{value.profiles[0].bio='真实付费老用户';},value=>{value.replies[0].authorId=randomUUID();},value=>{value.replies[0].postId=randomUUID();},value=>{value.posts[0].id=value.profiles[0].id;},
    value=>{delete value.provenance;},value=>{value.posts[0].createdAt=Date.now();}]) {
    const copy=structuredClone(manifest); mutate(copy); assert.throws(()=>validateForumSeed(copy));
  }
});
test('staging is harmless; one real D1 statement imports100/140/180 once with actual import timestamps',async t=>{
  const h=await fixture(t), before=Date.now(); await h.stage();
  assert.deepEqual(await h.counts(),{batches:0,authors:0,posts:0,replies:0,sessions:0,identity_votes:0,granted_credits:0});
  assert.equal((await h.commit()).meta.changes>0,true);
  assert.deepEqual(await h.counts(),{batches:1,authors:100,posts:140,replies:180,sessions:0,identity_votes:0,granted_credits:0});
  const stored=await h.DB.prepare('SELECT dataset_sha256,imported_at FROM forum_demo_batches WHERE id=?').bind(batch).first(); assert.equal(stored.dataset_sha256,hash); assert.ok(stored.imported_at>=before-10 && stored.imported_at<=Date.now()+10);
  const snapshot=await h.DB.prepare('SELECT id,created_at,updated_at FROM forum_posts WHERE demo_batch_id=? ORDER BY id').bind(batch).all();
  assert.ok(snapshot.results.every(row=>row.created_at===stored.imported_at && row.updated_at===stored.imported_at));
  await h.stage(); assert.equal((await h.commit()).meta.changes,0);
  assert.deepEqual((await h.DB.prepare('SELECT id,created_at,updated_at FROM forum_posts WHERE demo_batch_id=? ORDER BY id').bind(batch).all()).results,snapshot.results);
  const changed=structuredClone(manifest); changed.posts[0].body+=' 新版本'; const changedRaw=JSON.stringify(changed), changedHash=createHash('sha256').update(changedRaw).digest('hex');
  await assert.rejects(h.DB.batch(splitSqlStatements(buildForumSeedPackage(changedRaw,changedHash).stageSql).map(sql=>h.DB.prepare(sql))),/conflicts with sealed data/);
  assert.equal((await h.counts()).posts,140);
});
test('a collision with any real user, post without replies, or reply rolls back every expanded row',async t=>{
  for (const kind of ['user','post','reply']) {
    const h=await fixture(t), own=await h.account(), now=Date.now(), preserved=[];
    if (kind==='user') { await h.DB.prepare('INSERT INTO users(id,nickname,is_guest,role,created_at) VALUES(?,?,0,\'user\',?)').bind(manifest.profiles[0].id,'保留的真实账户',now).run(); preserved.push(['users',manifest.profiles[0].id]); }
    if (kind==='post') { await h.DB.prepare('INSERT INTO forum_posts(id,user_id,title,body,category,created_at,updated_at) VALUES(?,?,?,?,\'life\',?,?)').bind(manifest.posts[0].id,own.id,'保留的主题','没有回复的真实主题',now,now).run(); preserved.push(['forum_posts',manifest.posts[0].id]); }
    if (kind==='reply') {
      const parent=randomUUID(); await h.DB.prepare('INSERT INTO forum_posts(id,user_id,title,body,category,created_at,updated_at) VALUES(?,?,?,?,\'life\',?,?)').bind(parent,own.id,'保留的父主题','真实内容',now,now).run();
      await h.DB.prepare('INSERT INTO forum_replies(id,post_id,user_id,body,created_at) VALUES(?,?,?,?,?)').bind(manifest.replies[0].id,parent,own.id,'保留的真实回复',now).run(); preserved.push(['forum_posts',parent],['forum_replies',manifest.replies[0].id]);
    }
    const snapshots=await Promise.all(preserved.map(([table,id])=>h.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first()));
    await h.stage(); await assert.rejects(h.commit(),/UNIQUE constraint failed/);
    assert.deepEqual(await h.counts(),{batches:0,authors:0,posts:0,replies:0,sessions:0,identity_votes:0,granted_credits:0});
    for (let i=0;i<preserved.length;i++) assert.deepEqual(await h.DB.prepare(`SELECT * FROM ${preserved[i][0]} WHERE id=?`).bind(preserved[i][1]).first(),snapshots[i]);
  }
});
test('demo identities cannot create sessions, be claimed by guest UUID, acquire credentials, vote or receive Credit',async t=>{
  const h=await fixture(t); await h.seed(); const demo=manifest.profiles[0].id, own=await h.account('super');
  for (const key of ['id','userId']) { const result=await h.api('/v1/auth/guest',null,{[key]:demo}); assert.equal(result.status,409); assert.match(result.data.error,/演示署名/); }
  const original=crypto.randomUUID; crypto.randomUUID=()=>demo;
  try { const collision=await h.api('/v1/auth/guest',null,{}); assert.equal(collision.status,409); assert.match(collision.data.error,/冲突/); } finally { crypto.randomUUID=original; }
  await assert.rejects(h.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind('a'.repeat(64),demo,Date.now()+86400000,Date.now()).run(),/cannot authenticate/);
  await assert.rejects(h.DB.prepare('UPDATE sessions SET user_id=? WHERE user_id=?').bind(demo,own.id).run(),/cannot authenticate/);
  for (const query of ["UPDATE users SET is_demo=0,demo_batch_id=NULL WHERE id=?","UPDATE users SET role='super' WHERE id=?","UPDATE users SET email='demo@example.test',password_hash='invalid',is_guest=0 WHERE id=?"]) await assert.rejects(h.DB.prepare(query).bind(demo).run(),/cannot become login accounts/);
  await assert.rejects(h.DB.prepare('INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES(?,?,?,?,?)').bind('isolated-demo-forbidden',demo,100,'隔离检查',Date.now()).run(),/cannot authenticate/);
  await assert.rejects(h.DB.prepare('INSERT INTO admin_credit_adjustments(audit_id,user_id,credits,created_at) VALUES(?,?,?,?)').bind(randomUUID(),demo,100,Date.now()).run(),/cannot authenticate/);
  await assert.rejects(h.DB.prepare('INSERT INTO forum_votes(post_id,user_id,value) VALUES(?,?,1)').bind(manifest.posts[0].id,demo).run(),/cannot authenticate/);
  const guest=await h.api('/v1/auth/guest',null,{}); assert.equal(guest.status,200); assert.notEqual(guest.data.user.id,demo);
  const registered=await h.api('/v1/auth/register',null,{email:`${randomUUID()}@forum-seed.example.test`,password:'Original-test-password-2026!',nickname:'普通原创注册账户'}); assert.equal(registered.status,201); assert.equal(registered.data.user.isGuest,false);
  const forbiddenLogin=await h.api('/v1/auth/login',null,{email:`${demo}@forum-seed.example.test`,password:'Original-test-password-2026!'}); assert.equal(forbiddenLogin.status,401);
  const demoUser=await h.DB.prepare('SELECT email,password_hash,is_guest,is_demo,role FROM users WHERE id=?').bind(demo).first(); assert.deepEqual(demoUser,{email:null,password_hash:null,is_guest:1,is_demo:1,role:'user'});
  assert.equal((await h.counts()).sessions,0); assert.equal((await h.counts()).granted_credits,0); assert.equal((await h.counts()).identity_votes,0);
});
test('actual forum handler exposes explicit provenance while ordinary replies and real participation remain ordinary',async t=>{
  const h=await fixture(t); await h.seed(); const own=await h.account(), seedPost=manifest.posts[0];
  const page=await h.api('/v1/forum/posts?limit=30&q='+encodeURIComponent(seedPost.title),own); assert.equal(page.status,200);
  const post=page.data.posts.find(value=>value.id===seedPost.id); assert.equal(post.author.isDemo,true); assert.equal(post.author.nickname,manifest.profiles[0].nickname);
  assert.deepEqual(post.author.provenance,{kind:'fictional-demo',source:'original',label:'官方原创示例',batchId:batch}); assert.equal(post.upvotes,0); assert.equal(post.downvotes,0);
  const detail=await h.api(`/v1/forum/posts/${post.id}`,own); assert.equal(detail.status,200); assert.ok(detail.data.replies.length>0); assert.ok(detail.data.replies.every(reply=>reply.author.isDemo===true));
  assert.equal(detail.data.post.replyCount,(await h.DB.prepare('SELECT COUNT(*) AS n FROM forum_replies WHERE post_id=?').bind(post.id).first()).n);
  const reply=await h.api(`/v1/forum/posts/${post.id}/replies`,own,{body:'这是隔离真实账户发表的原创回复。'}); assert.equal(reply.status,201); assert.deepEqual(reply.data.reply.author,{id:own.id,nickname:own.nickname});
  const updated=await h.api(`/v1/forum/posts/${post.id}`,own); assert.equal(updated.data.replies.find(value=>value.id===reply.data.reply.id).author.isDemo,undefined);
  const vote=await h.api(`/v1/forum/posts/${post.id}/vote`,own,{value:1},'PUT'); assert.equal(vote.status,200); assert.equal(vote.data.post.upvotes,1);
  const normal=await h.api('/v1/forum/posts',own,{title:'普通原创主题',body:'保留正常创建流程。',category:'life',tags:['普通原创']}); assert.equal(normal.status,201); assert.equal(normal.data.post.author.isDemo,undefined);
  await assert.rejects(h.DB.prepare(pack.rollbackSql).run(),/real participation exists/);
  assert.equal((await h.DB.prepare('SELECT body FROM forum_replies WHERE id=?').bind(reply.data.reply.id).first()).body,'这是隔离真实账户发表的原创回复。');
  assert.equal((await h.counts()).replies,180); assert.equal((await h.counts()).identity_votes,0);
});
test('admin user counts and listings exclude fictional authors; untouched batch reversal preserves real accounts',async t=>{
  const h=await fixture(t), admin=await h.account('super');
  const before=await h.api('/v1/admin/overview',admin); assert.equal(before.status,200); await h.seed();
  const after=await h.api('/v1/admin/overview',admin); assert.equal(after.status,200);
  for (const key of ['users','registeredUsers','guestUsers','superUsers','totalAvailableCredits','totalReservedCredits','totalSpentCredits']) assert.equal(after.data.stats[key],before.data.stats[key]);
  assert.equal(after.data.stats.forumPosts,before.data.stats.forumPosts+140);
  const list=await h.api('/v1/admin/users?limit=50',admin); assert.equal(list.status,200); assert.equal(list.data.total,1); assert.equal(list.data.items[0].id,admin.id);
  assert.equal((await h.api('/v1/admin/users?q='+encodeURIComponent(manifest.profiles[0].nickname),admin)).data.total,0);
  await h.DB.prepare(pack.rollbackSql).run(); assert.deepEqual(await h.counts(),{batches:0,authors:0,posts:0,replies:0,sessions:0,identity_votes:0,granted_credits:0});
  assert.equal((await h.DB.prepare('SELECT role,is_demo FROM users WHERE id=?').bind(admin.id).first()).role,'super');
  assert.equal((await h.api('/v1/session',admin)).data.user.id,admin.id);
});
test('missing staging fragments or manifest fields fail closed; edited seed content refuses destructive reversal',async t=>{
  const h=await fixture(t), parts=splitSqlStatements(pack.stageSql); await h.DB.batch(parts.slice(0,-1).map(sql=>h.DB.prepare(sql)));
  await assert.rejects(h.commit(),/NOT NULL|CHECK/); assert.equal((await h.counts()).authors,0);
  const incomplete=structuredClone(manifest); delete incomplete.isDemo;
  await assert.rejects(h.DB.prepare('INSERT INTO forum_demo_batches(id,dataset_sha256,source_batch_id,manifest_json,imported_at) VALUES(?,?,?,?,?)').bind(batch,hash,manifest.sourceBatchId,JSON.stringify(incomplete),Date.now()).run(),/CHECK/);
  await h.seed(); await h.DB.prepare('UPDATE forum_posts SET body=? WHERE id=?').bind('管理员修改后应被保留的内容',manifest.posts[0].id).run();
  await assert.rejects(h.DB.prepare(pack.rollbackSql).run(),/content changed/);
  assert.equal((await h.DB.prepare('SELECT body FROM forum_posts WHERE id=?').bind(manifest.posts[0].id).first()).body,'管理员修改后应被保留的内容'); assert.equal((await h.counts()).authors,100);
});
