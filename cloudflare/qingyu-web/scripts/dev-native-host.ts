/** Local adapters for the SAME durable coordinator and native MaiBot runtime.
 * No original instances, credentials, databases or ports are discovered or reused.
 */
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, openSync, closeSync, writeSync, unlinkSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename, readdir, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { CompanionHost, UUID, type HostEnv, type Storage, type Bucket, type Runtime } from '../engine/cloudflare/qingyu-companion/src/host';
const root=fileURLToPath(new URL('../',import.meta.url).href);
const directory=resolve(root,'.runtime/native-host');
const nativeSource=resolve(root,'engine/companion-native/upstream');
const runtimeSource=resolve(root,'engine/companion-native/runtime');
const configPath=resolve(root,'engine/cloudflare/qingyu-companion/.dev.vars');
const config=Object.fromEntries((await readFile(configPath,'utf8')).trim().split('\n').filter(line=>/^[A-Z_][A-Z_0-9]*=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),JSON.parse(line.slice(at+1))];}));
const token=config.COMPANION_LOCAL_TOKEN;
if(typeof token!=='string'||token.length<32)throw new Error('Independent local native service token is required.');
const env:HostEnv={...config,COMPANION_BILLING_ENABLED:'false'};
await mkdir(directory,{recursive:true,mode:0o700});
// Two hosts must never coordinate the same native files concurrently.
const lockPath=join(directory,'.service-lock');
const lock=openSync(lockPath,'wx',0o600);
writeSync(lock,String(process.pid));closeSync(lock);
process.once('exit',()=>{try{unlinkSync(lockPath);}catch{}});
async function atomic(path:string,value:unknown){
  await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temporary,path);
}
async function port(){
 const server=createTcpServer();await new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
 const value=(server.address()as any).port;await new Promise<void>(done=>server.close(()=>done()));return value as number;
}
function safeObject(key:string){const path=resolve(directory,'objects',key);if(!path.startsWith(resolve(directory,'objects')+sep))throw new Error('Invalid native object path');return path;}
const bucket:Bucket={
 async get(key){
  const path=safeObject(key);try{const [metadata,info]=await Promise.all([readFile(path+'.json','utf8'),stat(path)]);const value=JSON.parse(metadata);
   return {body:Readable.toWeb(createReadStream(path))as unknown as ReadableStream<Uint8Array>,size:info.size,etag:value.etag,sha256:value.sha256,metadata:value.metadata};
  }catch(error:any){if(error.code==='ENOENT')return null;throw error;}
 },
 async put(key,input,options){
  const path=safeObject(key);await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
  let size=0,created=false;const hash=createHash('sha256');
  const meter=new Transform({transform(chunk,_encoding,done){size+=chunk.length;if(size>1024*1024*1024)return done(new Error('Snapshot too large'));hash.update(chunk);done(null,chunk);}});
  try{
   const source=typeof input==='string'?Readable.from([Buffer.from(input)]):Readable.fromWeb(input as any);
   const output=createWriteStream(path,{flags:'wx',mode:0o600});output.once('open',()=>{created=true;});
   await pipeline(source,meter,output);
   const sha256=hash.digest('hex');if(options.length!==undefined&&options.length!==size||options.sha256&&options.sha256!==sha256)throw new Error('Snapshot integrity mismatch');
   await atomic(path+'.json',{etag:sha256,sha256,metadata:options.metadata});return{etag:sha256};
  }catch(error){if(created)await rm(path,{force:true});throw error;}
 },
};
type Entry={host:CompanionHost;runtime:Runtime};
const entries=new Map<string,Promise<Entry>>();
const activeScopes=new Set<string>();
async function entry(account:string,profile:string):Promise<Entry>{
 const scope=`${account}:${profile}`;
 if(entries.has(scope))return entries.get(scope)!;
 const creating=(async()=>{
  const store=join(directory,'coordination',scope),container=join(directory,'runtime-containers',`${account}-${profile}`);
  await mkdir(store,{recursive:true,mode:0o700});
  let coordinates:Record<string,number>;
  try{coordinates=JSON.parse(await readFile(join(store,'.ports'),'utf8'));}
  catch(error:any){if(error.code!=='ENOENT')throw error;const values=await Promise.all([port(),port(),port(),port(),port()]);coordinates=Object.fromEntries(['control','webui','gateway','api','ws'].map((key,index)=>[key,values[index]]));await atomic(join(store,'.ports'),coordinates);}
  const {control:controlPort,webui:webuiPort,gateway:gatewayPort,api:apiPort,ws:wsPort}=coordinates;
  if(!Object.values(coordinates).every(value=>Number.isSafeInteger(value)&&value>=1024&&value<=65535))throw new Error('Invalid owned native port record');
  let child:ReturnType<typeof spawn>|undefined,alarm:ReturnType<typeof setTimeout>|undefined;
  const storage:Storage={
   async get<T>(key:string){try{return JSON.parse(await readFile(join(store,Buffer.from(key).toString('base64url')+'.json'),'utf8'))as T;}catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}},
   put:async(key,value)=>atomic(join(store,Buffer.from(key).toString('base64url')+'.json'),value),
   delete:async key=>{await rm(join(store,Buffer.from(key).toString('base64url')+'.json'),{force:true});},
   async list<T>(options:{prefix?:string;limit?:number}={}){
    const selected=new Map<string,T>();for(const file of await readdir(store)){
     if(!file.endsWith('.json'))continue;const key=Buffer.from(file.slice(0,-5),'base64url').toString();
     if(options.prefix&&!key.startsWith(options.prefix))continue;
     selected.set(key,JSON.parse(await readFile(join(store,file),'utf8')));
     if(options.limit&&selected.size>=options.limit)break;
    }return selected;
   },
   async setAlarm(time){if(alarm)clearTimeout(alarm);alarm=setTimeout(()=>void instance.host.alarm(),Math.max(1,time-Date.now()));alarm.unref();},
  };
  const runtime:Runtime={
   get running(){return Boolean(child&&child.exitCode===null&&!child.killed);},
   start(runtimeEnv){
    if(activeScopes.size>=5)throw new Error("Native development capacity reached");
    activeScopes.add(scope);
    const log=openSync(join(store,'controller.log'),'a',0o600);
    const childEnv={...runtimeEnv,PATH:process.env.PATH,TZ:'Asia/Shanghai',
     PORT:String(controlPort),MAIBOT_WEBUI_PORT:String(webuiPort),MAIBOT_GATEWAY_PORT:String(gatewayPort),MAIBOT_API_PORT:String(apiPort),MAIBOT_WS_PORT:String(wsPort),
     COMPANION_INSTANCE_DIR:join(container,'instance'),MAIBOT_SOURCE_DIR:nativeSource,COMPANION_MEDIA_PLUGIN_DIR:resolve(root,'engine/companion-native/plugins/xumeng_media'),
     HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,ALL_PROXY:process.env.ALL_PROXY,
    };
    try{child=spawn(process.execPath,[join(runtimeSource,'control.mjs')],{cwd:runtimeSource,env:childEnv,stdio:['ignore',log,log]});child.once('error',()=>{activeScopes.delete(scope);});child.once('exit',()=>{activeScopes.delete(scope);});}finally{closeSync(log);}
   },
   async setInactivityTimeout(){},
   fetch(path,init){return fetch(`http://127.0.0.1:${controlPort}${path}`,{...init,...(init?.body instanceof ReadableStream?{duplex:'half'}:{})}as RequestInit);},
   async destroy(){
    if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;}
    child=undefined;activeScopes.delete(scope);await rm(container,{recursive:true,force:true});
   },
  };
  const instance:Entry={host:new CompanionHost(storage,bucket,runtime,env),runtime};
  return instance;
 })();entries.set(scope,creating);return creating;
}
const server=createServer(async(req,res)=>{
 const answer=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return answer(401,{error:'Private local service'});
 if(req.url==='/__health')return answer(200,{ready:true,engine:'native-maibot',startedInstances:entries.size,agreementsConfigured:config.COMPANION_AGREEMENTS_ACCEPTED==='1'});
 const account=String(req.headers['x-xumeng-account-id']??'').toLowerCase(),profile=String(req.headers['x-qingyu-companion-profile']??'classic');
 if(!UUID.test(account)||!['classic','intimate','traveler'].includes(profile))return answer(403,{error:'Invalid native scope'});
 try{
  const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24_000)return answer(413,{error:'Request too large'});chunks.push(chunk);}
  const headers=new Headers({'x-xumeng-account-id':account,'x-qingyu-companion-profile':profile});
  if(req.headers['content-type'])headers.set('content-type',req.headers['content-type']);
  if(req.headers['x-xumeng-session-token'])headers.set('x-xumeng-session-token',String(req.headers['x-xumeng-session-token']));
  const target=await entry(account,profile);
  const response=await target.host.fetch(new Request(`http://companion.local${req.url}`,{method:req.method,headers,...(size?{body:Buffer.concat(chunks)}:{})}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{return answer(503,{error:'Local native runtime unavailable'});}
});
const servicePort=Number(config.COMPANION_LOCAL_PORT??8797);
server.listen(servicePort,'127.0.0.1',()=>console.log(`Qingyu native development host ready at 127.0.0.1:${servicePort}; no native instance starts automatically.`));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
 if(stopping)return;stopping=true;
 void(async()=>{
  const ready=await Promise.all([...entries.values()]);await Promise.allSettled(ready.map(item=>item.host.checkpointNow()));
  if(ready.some(item=>item.runtime.running)){console.error('Native files retained: checkpoint did not finish. The local service remains available for recovery.');stopping=false;return;}
  server.close(()=>process.exit(0));
 })();
});
