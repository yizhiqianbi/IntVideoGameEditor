import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This tool performs no network requests, credential reads or database writes.
// Root applies the reviewed statements separately. The final INSERT expands
// atomically through migration0029; staging chunks never create accounts/posts.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BATCH = 'forum-seed-20261009', SOURCE = 'demo-community-20261009';
const GENRES = new Set(['日常','古风','奇幻','科幻','悬疑','轻喜剧','冒险','治愈','职场','经营']);
const CATEGORIES = new Set(['characters','social','life','help']);
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function assert(condition, message) { if (!condition) throw new Error(message); }
function keys(value, expected, label) {
  assert(object(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key)), `${label}: unexpected or missing fields`);
}
function text(value, max, label) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), `${label}: invalid text`); }
function demo(value) { assert(value.isDemo === true && value.batchId === BATCH, 'Each object must have explicit demo provenance'); }
export function validateForumSeed(value) {
  keys(value, ['schemaVersion','batchId','isDemo','generatedAt','sourceBatchId','provenance','profiles','posts','replies'], 'manifest');
  assert(value.schemaVersion === 1 && value.batchId === BATCH && value.isDemo === true && value.sourceBatchId === SOURCE, 'Unexpected sealed batch');
  assert(typeof value.generatedAt === 'string' && !Number.isNaN(Date.parse(value.generatedAt)) && new Date(value.generatedAt).toISOString() === value.generatedAt, 'generatedAt must be an actual ISO timestamp');
  keys(value.provenance, ['kind','source','label','batchId'], 'provenance');
  assert(value.provenance.kind === 'fictional-demo' && value.provenance.source === 'original' && value.provenance.label === '官方原创示例' && value.provenance.batchId === BATCH, 'Missing original fictional-demo provenance');
  for (const [name, count] of [['profiles',100],['posts',140],['replies',180]]) assert(Array.isArray(value[name]) && value[name].length === count, `${name}: require exactly${count}`);
  const all = new Set(), profiles = new Set(), posts = new Set(), authorPosts = new Map();
  const id = value => { assert(typeof value === 'string' && UUID.test(value) && !all.has(value), 'All object IDs must be globally unique UUIDs'); all.add(value); };
  for (const profile of value.profiles) {
    keys(profile, ['id','nickname','bio','genres','isDemo','batchId'], 'profile'); demo(profile); id(profile.id);
    text(profile.nickname,60,'nickname'); text(profile.bio,1000,'bio'); assert(/虚构|演示/.test(profile.bio), 'Profile bio must disclose fictional authorship');
    assert(Array.isArray(profile.genres) && profile.genres.length > 0 && profile.genres.length <= 3 && new Set(profile.genres).size === profile.genres.length && profile.genres.every(genre => GENRES.has(genre)), 'Invalid genres');
    profiles.add(profile.id); authorPosts.set(profile.id,0);
  }
  for (const post of value.posts) {
    keys(post, ['id','authorId','title','body','category','tags','isDemo','batchId'], 'post'); demo(post); id(post.id);
    assert(profiles.has(post.authorId) && CATEGORIES.has(post.category), 'Unknown author or prohibited real category');
    text(post.title,120,'post title'); text(post.body,12000,'post body');
    assert(Array.isArray(post.tags) && post.tags.length > 0 && post.tags.length <= 10 && new Set(post.tags).size === post.tags.length && post.tags.includes('原创示例'), 'Each post requires unique original-example tags');
    post.tags.forEach(tag => text(tag,40,'tag')); posts.add(post.id); authorPosts.set(post.authorId,authorPosts.get(post.authorId)+1);
  }
  assert([...authorPosts.values()].every(count => count > 0), 'Every fictional author must have a post');
  for (const reply of value.replies) {
    keys(reply, ['id','postId','authorId','body','isDemo','batchId'], 'reply'); demo(reply); id(reply.id);
    assert(profiles.has(reply.authorId) && posts.has(reply.postId), 'Unknown reply author or parent post'); text(reply.body,4000,'reply body');
  }
  return value;
}
function chunks(raw) {
  const result = []; let current = '', bytes = 0;
  for (const char of raw) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 12000) { result.push(current); current = ''; bytes = 0; }
    current += char; bytes += size;
  }
  if (current) result.push(current);
  assert(result.length > 0 && result.length <= 128, 'Dataset exceeds bounded staging size');
  return result;
}
export function batchCountSql(batchId = BATCH) {
  assert(batchId === BATCH, 'Counts are restricted to the sealed batch'); const b = quote(batchId);
  return `SELECT
 (SELECT COUNT(*) FROM forum_demo_batches WHERE id=${b}) AS batches,
 (SELECT COUNT(*) FROM users WHERE is_demo=1 AND demo_batch_id=${b}) AS authors,
 (SELECT COUNT(*) FROM forum_posts WHERE demo_batch_id=${b}) AS posts,
 (SELECT COUNT(*) FROM forum_replies WHERE demo_batch_id=${b}) AS replies,
 (SELECT COUNT(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.is_demo=1 AND u.demo_batch_id=${b}) AS sessions,
 (SELECT COUNT(*) FROM forum_votes v JOIN users u ON u.id=v.user_id WHERE u.is_demo=1 AND u.demo_batch_id=${b}) AS identity_votes,
 (SELECT COALESCE(SUM(b.granted_credits),0) FROM credit_usage_balances b JOIN users u ON u.id=b.user_id WHERE u.is_demo=1 AND u.demo_batch_id=${b}) AS granted_credits;\n`;
}
export function buildForumSeedPackage(raw, expectedHash) {
  assert(typeof raw === 'string' && Buffer.byteLength(raw) <= 1_500_000 && !raw.includes('\0'), 'Dataset exceeds bounded file size');
  assert(typeof expectedHash === 'string' && /^[a-f0-9]{64}$/.test(expectedHash) && sha(raw) === expectedHash, 'Sealed SHA256 does not match');
  const value = validateForumSeed(JSON.parse(raw)), parts = chunks(raw), batch = quote(BATCH), hash = quote(expectedHash);
  const stage = parts.map((content,position) => `INSERT INTO forum_demo_seed_chunks(batch_id,position,dataset_sha256,chunk_sha256,content) VALUES(${batch},${position},${hash},${quote(sha(content))},${quote(content)}) ON CONFLICT(batch_id,position) DO NOTHING;`).join('\n');
  const assembled = `(SELECT group_concat(content,'') FROM (SELECT content FROM forum_demo_seed_chunks WHERE batch_id=${batch} AND dataset_sha256=${hash} ORDER BY position))`;
  const complete = `(SELECT COUNT(*) FROM forum_demo_seed_chunks WHERE batch_id=${batch})=${parts.length} AND (SELECT COUNT(*) FROM forum_demo_seed_chunks WHERE batch_id=${batch} AND dataset_sha256=${hash})=${parts.length} AND (SELECT MIN(position) FROM forum_demo_seed_chunks WHERE batch_id=${batch})=0 AND (SELECT MAX(position) FROM forum_demo_seed_chunks WHERE batch_id=${batch})=${parts.length-1}`;
  // Use an ordinary INSERT. An outer OR IGNORE policy must never cause the
  // expansion trigger to ignore a real post/reply/user ID collision.
  const commit = `INSERT INTO forum_demo_batches(id,dataset_sha256,source_batch_id,manifest_json,imported_at) SELECT ${batch},${hash},${quote(SOURCE)},CASE WHEN ${complete} THEN ${assembled} ELSE NULL END,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE NOT EXISTS(SELECT 1 FROM forum_demo_batches WHERE id=${batch} AND dataset_sha256=${hash} AND source_batch_id=${quote(SOURCE)} AND manifest_json=${assembled});\n`;
  const rollback = `DELETE FROM forum_demo_batches WHERE id=${batch} AND dataset_sha256=${hash};\n`;
  return { stageSql: stage+'\n', commitSql: commit, countSql: batchCountSql(), rollbackSql: rollback,
    report: { schemaVersion:1,batchId:BATCH,sourceBatchId:SOURCE,datasetSha256:expectedHash,profiles:value.profiles.length,posts:value.posts.length,replies:value.replies.length,
      stagingChunks:parts.length,maxStatementBytes:Math.max(...stage.split(/;\n/).map(statement => Buffer.byteLength(statement)),Buffer.byteLength(commit)),
      loginIdentities:false,seedVotes:0,seedTransactions:0,databaseWrites:false,networkCalls:0,atomicExpansion:true } };
}
async function main() {
  const args = process.argv.slice(2); const options = {};
  for (let i=0;i<args.length;i+=2) { assert(['--input','--sha256','--out-dir'].includes(args[i]) && args[i+1] && !options[args[i]], 'Use --input sealed.json --sha256 expected --out-dir directory'); options[args[i]]=args[i+1]; }
  assert(Object.keys(options).length===3,'All three explicit arguments are required');
  const input=resolve(options['--input']), out=resolve(options['--out-dir']), raw=await readFile(input,'utf8');
  const result=buildForumSeedPackage(raw,options['--sha256']); await mkdir(out,{recursive:true});
  for (const [name,body] of [['stage.sql',result.stageSql],['commit.sql',result.commitSql],['counts.sql',result.countSql],['rollback.sql',result.rollbackSql],['package-report.json',JSON.stringify(result.report,null,2)+'\n']]) await writeFile(join(out,name),body,{flag:'wx'});
  process.stdout.write(JSON.stringify(result.report)+'\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
