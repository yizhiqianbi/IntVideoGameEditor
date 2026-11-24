// Fetch only JavaScript resources literally declared by the public HTML/JS.
// No application execution, API calls, credentials, browser profile or media.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createHash} from 'node:crypto';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'public');const dir=join(root,'scripts');await mkdir(dir,{recursive:true});
const declared=JSON.parse(await readFile(join(root,'official-declared-scripts.json'),'utf8'));const queue=declared.urls.map(url=>({url,declaredBy:declared.sourceUrl}));const seen=new Set(queue.map(x=>x.url));const records=[];let total=0;const run=promisify(execFile);const hash=text=>createHash('sha256').update(text).digest('hex');
while(queue.length&&records.length<100&&total<10000000){
 const batch=queue.splice(0,4);await Promise.all(batch.map(async item=>{
 const name=new URL(item.url).pathname.split('/').at(-1);
 try{const {stdout}=await run('curl',['--max-time','15','-x','http://127.0.0.1:7897','-fsSL',item.url],{maxBuffer:4000000});if(/^\s*<!doctype|^\s*<html/iu.test(stdout))throw new Error('HTML instead of JavaScript');
 const bytes=Buffer.byteLength(stdout);total+=bytes;await writeFile(join(dir,name),stdout);records.push({...item,file:'scripts/'+name,bytes,sha256:hash(stdout),status:'saved'});
 const references=[...stdout.matchAll(/["']((?:\.\/|\/assets\/|assets\/)?[A-Za-z0-9_-]{3,}\.js)["']/g)];
 for(const match of references){const url=new URL(match[1].startsWith('assets/') ? '/'+match[1] : match[1],item.url).href;const u=new URL(url);if(u.origin!=='https://www.dzmm.ai'||!u.pathname.startsWith('/assets/')||seen.has(url))continue;seen.add(url);queue.push({url,declaredBy:item.url});}
 }catch(error){records.push({...item,status:'unavailable',error:String(error.message).slice(0,130)});}
 }));
}
records.sort((a,b)=>a.url.localeCompare(b.url));const report={retrievedAt:new Date().toISOString(),sourceUrl:declared.sourceUrl,transport:'existing system HTTP proxy 127.0.0.1:7897',scope:'public declared JavaScript only',limits:{files:100,totalBytes:10000000,parallel:4},totalBytes:total,remainingDeclaredUrls:queue.length,records};
await writeFile(join(root,'script-manifest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({saved:records.filter(x=>x.status==='saved').length,unavailable:records.filter(x=>x.status!=='saved').length,totalBytes:total,remaining:queue.length}));
