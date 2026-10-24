import {readdir,readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const root=new URL('../engine/companion-native/',import.meta.url);
const files={};
async function visit(path=''){
 for(const entry of await readdir(new URL(path,root),{withFileTypes:true})){
  if(['.venv','__pycache__','.git','node_modules','build'].includes(entry.name)||entry.name.endsWith('.egg-info')||entry.name.startsWith('.dev.vars')||entry.name.endsWith('.pyc')||['build-manifest.json','upstream-build-manifest.json'].includes(entry.name))continue;
  const name=path+entry.name;
  if(entry.isDirectory())await visit(name+'/');
  else if(entry.isFile())files[name]=createHash('sha256').update(await readFile(new URL(name,root))).digest('hex');
 }
}
await visit();await writeFile(new URL('build-manifest.json',root),JSON.stringify({edition:'qingyu-all-ages',sourceManifest:'upstream-build-manifest.json',files},null,2)+'\n');
console.log(JSON.stringify({files:Object.keys(files).length,reviewResources:['plugins/xumeng_media/review.py','plugins/xumeng_media/review-policy.json'],nativeExtension:'upstream/src/webui/routers/websocket/unified.py'}));
