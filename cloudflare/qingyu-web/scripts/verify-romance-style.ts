import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildDzmmPromptPlan } from '../engine/src/lib/dzmm-chat';
import { QINGYU_CHARACTERS } from '../engine/src/lib/qingyu-catalog';
import { CLASSIC_STYLE } from '../engine/src/app/xumeng/girlfriend/companion-style';
import { INTIMATE_STYLE } from '../engine/src/app/xumeng/girlfriend/intimate-style';
import { buildQingyuCompanionTurn } from '../engine/cloudflare/qingyu-companion/src/host';
import { QINGYU_ROMANCE_STYLE } from '../engine/src/lib/qingyu-romance-style';
import { reviewContent } from '../src/server/policy';
const env = Object.fromEntries((await readFile(new URL('../.dev.vars', import.meta.url),'utf8')).trim().split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{ const at=line.indexOf('=');return [line.slice(0,at),JSON.parse(line.slice(at+1))]; }));
const cases = [
  {name:'companion-comfort',mode:'companion',input:'今天的汇报被否了，我有点委屈。不想听大道理，想被认真哄一会儿。',identity:'你是陆时予，26岁的男性钢琴家。',style:CLASSIC_STYLE},
  {name:'companion-declined-plan',mode:'companion',input:'今天不想去看展了，我只想一个人待着。你先别替我安排，好吗？',identity:'你是沈聿，28岁的男性古籍修复师。',style:INTIMATE_STYLE},
  {name:'tavern-gentle-lead',mode:'tavern',input:'这些旧纸页我有点不敢碰，怕把事情搞砸。你可以带我做第一步吗？别笑我。',card:QINGYU_CHARACTERS[1]},
  {name:'tavern-new-scene-and-tone',mode:'tavern',input:'两周后，我们已经离开车站。今天我在花店做采访整理，想和你认真聊聊影集的工作，先不要暧昧。',card:QINGYU_CHARACTERS[2]},
];
const results=await Promise.all(cases.map(async item=>{
 const messages=item.mode==='companion'?[{role:'system',content:[item.identity,QINGYU_ROMANCE_STYLE.tone,QINGYU_ROMANCE_STYLE.relationship,QINGYU_ROMANCE_STYLE.companion,'所有内容适合全年龄，不诱导排他依赖，不宣称是真人；不写名字标签、括号动作或心理描写。'].join('\n')},{role:'user',content:buildQingyuCompanionTurn(item.style,item.input,item.identity)}]
   :buildDzmmPromptPlan({character:item.card!,messages:[{role:'assistant',content:item.card!.firstMessage},{role:'user',content:item.input}],model:'fast',maxTokens:512}).messages;
 const response=await fetch(`${env.CHAT_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.CHAT_API_KEY}`},body:JSON.stringify({model:env.CHAT_MODEL,messages,max_tokens:512,temperature:.65,reasoning:{effort:'none',exclude:true}}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)return {name:item.name,status:response.status,input:item.input,output:null};
 const data=await response.json() as {choices?:Array<{message?:{content?:string},finish_reason?:string}>};
 const output=data.choices?.[0]?.message?.content??'';
 let moderation='allowed';try{await reviewContent(output,env);}catch{moderation='not-approved';}
 return {name:item.name,status:response.status,input:item.input,output,finishReason:data.choices?.[0]?.finish_reason,moderation};
}));
await writeFile(new URL('../evidence/romance-style-live-samples.json',import.meta.url),JSON.stringify({version:QINGYU_ROMANCE_STYLE.version,styleSha256:createHash('sha256').update(JSON.stringify(QINGYU_ROMANCE_STYLE)).digest('hex'),model:env.CHAT_MODEL,createdAt:new Date().toISOString(),scope:'Synthetic live provider samples using the production tavern assembler and companion turn wrapper. Companion base style mirrors the shared native configuration; the core runtime and historical memory were not exercised.',results},null,2)+'\n');
console.log(JSON.stringify(results.map(({name,status,output,...rest})=>({name,status,...rest,output})),null,2));
if(results.some(r=>r.status!==200||!r.output||r.moderation!=='allowed'))process.exitCode=1;
