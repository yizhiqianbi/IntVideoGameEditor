import {readFile,writeFile,chmod} from 'node:fs/promises';import {randomBytes,createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const parse=text=>Object.fromEntries(text.trim().split('\n').filter(line=>/^[A-Z_][A-Z_0-9]*=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),JSON.parse(line.slice(at+1))];}));
const app=parse(await readFile(new URL('.dev.vars',root),'utf8'));
const accepted=await readFile(new URL('../xumeng-companion/wrangler.jsonc',root),'utf8');
const setting=name=>accepted.match(new RegExp('"'+name+'"\\s*:\\s*"([^"\\n]+)"'))?.[1];
const protocol={};
for(const [name,key]of[['EULA.md','COMPANION_EULA_MD5'],['PRIVACY.md','COMPANION_PRIVACY_MD5']]){
 const hash=createHash('md5').update(await readFile(new URL('engine/companion-native/upstream/'+name,root))).digest('hex');
 if(hash!==setting(key)||setting('COMPANION_AGREEMENTS_ACCEPTED')!=='1')throw new Error('The copied component agreements differ from the existing accepted configuration; explicit review is required.');
 protocol[key]=hash;
}
const target=new URL('engine/cloudflare/qingyu-companion/.dev.vars',root);
let previous={};try{previous=parse(await readFile(target,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const token=previous.COMPANION_LOCAL_TOKEN||randomBytes(32).toString('hex');
const config={...previous,COMPANION_LOCAL_TOKEN:token,COMPANION_LOCAL_PORT:'8797',COMPANION_OPENROUTER_BASE_URL:app.CHAT_BASE_URL,
 COMPANION_OPENROUTER_API_KEY:app.CHAT_API_KEY,COMPANION_CHAT_MODEL:app.CHAT_MODEL,COMPANION_EMBEDDING_MODEL:'qwen/qwen3-embedding-8b',COMPANION_EMBEDDING_DIMENSION:'4096',
 COMPANION_REVIEW_MODEL:app.MODERATION_MODEL,COMPANION_MEDIA_REVIEW_SECRET:app.COMPANION_MEDIA_REVIEW_SECRET,COMPANION_TTS_VOICE:'rex',
 ...protocol,COMPANION_AGREEMENTS_ACCEPTED:'1',COMPANION_BILLING_ENABLED:'false'};
app.COMPANION_LOCAL_URL='http://127.0.0.1:8797';app.COMPANION_LOCAL_TOKEN=token;app.COMPANION_LOCAL_MODE='true';
const serialize=value=>Object.entries(value).map(([key,text])=>key+'='+JSON.stringify(text)).join('\n')+'\n';
await writeFile(target,serialize(config),{mode:0o600});await chmod(target,0o600);
await writeFile(new URL('.dev.vars',root),serialize(app),{mode:0o600});await chmod(new URL('.dev.vars',root),0o600);
await writeFile(new URL('evidence/native-local-configuration.json',root),JSON.stringify({providerAccount:'authorized existing account; no original credentials/configuration written',agreements:'existing accepted flags reused only after both copied document fingerprints match exactly',storage:'.runtime/native-host',binding:'loopback-only private development service; Cloudflare binding retained',credentials:'omitted'},null,2)+'\n');
console.log('Independent native configuration ready. Existing accepted document fingerprints match. Credentials omitted.');
