import { mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'../../..');
const dest=resolve(import.meta.dirname,'../engine');
const pairs=[['src','src'],['cloudflare/dzmm/src','cloudflare/dzmm/src'],['cloudflare/dzmm/migrations','cloudflare/dzmm/migrations'],['cloudflare/dzmm/test','cloudflare/dzmm/test'],['cloudflare/dzmm/scripts','cloudflare/dzmm/scripts'],['cloudflare/dzmm-web/src','cloudflare/dzmm-web/src'],['cloudflare/dzmm-web/test','cloudflare/dzmm-web/test']];
const baseline={};
async function walk(p){for(const d of await readdir(p,{withFileTypes:true})){const f=join(p,d.name);if(d.isDirectory())await walk(f);else if(d.isFile())baseline[relative(root,f)]=createHash('sha256').update(await readFile(f)).digest('hex');}}
for(const [src,out] of pairs){await walk(join(root,src));await mkdir(resolve(dest,out,'..'),{recursive:true});await cp(join(root,src),join(dest,out),{recursive:true,errorOnExist:true,force:false});}
await writeFile(resolve(dest,'../evidence/full-engine-baseline.json'),JSON.stringify({createdAt:new Date().toISOString(),files:baseline},null,2));
console.log(`Copied ${Object.keys(baseline).length} source files into independent engine. No original writes.`);
