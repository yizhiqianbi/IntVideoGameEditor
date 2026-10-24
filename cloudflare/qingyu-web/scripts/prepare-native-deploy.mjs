import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,sep} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'engine/companion-native');
const destination=resolve(root,'.runtime/deploy/native-context');
const manifest=JSON.parse(await readFile(resolve(source,'build-manifest.json'),'utf8'));
for(const [relative,expected] of Object.entries(manifest.files)){
  const input=resolve(source,relative),output=resolve(destination,relative);
  if(!input.startsWith(source+sep)||!output.startsWith(destination+sep)||(await lstat(input)).isSymbolicLink())throw new Error('Invalid native build path');
  const bytes=await readFile(input);
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Native build manifest is stale: '+relative);
  await mkdir(dirname(output),{recursive:true});await writeFile(output,bytes);
}
await copyFile(resolve(source,'build-manifest.json'),resolve(destination,'build-manifest.json'));
const config=JSON.parse(await readFile(resolve(root,'engine/cloudflare/qingyu-companion/wrangler.jsonc'),'utf8'));
config.main=resolve(root,'engine/cloudflare/qingyu-companion/src/index.ts');
config.containers[0].image=resolve(destination,'Dockerfile');
config.containers[0].image_build_context=destination;
await writeFile(resolve(root,'.runtime/deploy/companion.wrangler.json'),JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({files:Object.keys(manifest.files).length,context:destination,credentialsIncluded:false}));
