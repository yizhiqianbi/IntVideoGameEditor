import { ApiError } from './http';
import { chargeDzmmProviderCostUsd, parseDzmmProviderCostUsd, type DzmmCreditCostPolicy } from '../../../src/lib/dzmm-credit-pricing';

export type GenerationKind = 'image' | 'video';
export type GenerationModel = { id:string; label:string; kind:GenerationKind; aspectRatios:readonly string[]; resolutions:readonly string[];
  durations:readonly number[]; resolution:string; quality?:string; unitUsd:number; sku:string; generateAudio?:boolean; supportsReferenceImage:boolean; referenceUnitUsd:number };
const IMAGE_RATIOS = ['1:1','3:4','4:3','9:16','16:9','2:3','3:2'] as const;
const VIDEO_RATIOS = ['16:9','9:16','1:1','4:3','3:4','3:2','2:3'] as const;
/** Reviewed public OpenRouter image endpoint pricing/video SKU catalog 2026-10-08.
 * Grok video cents_per_video_output_second_720p=3 is USD 0.03, not USD 3. */
export const GENERATION_MODELS:readonly GenerationModel[] = [
  {id:'x-ai/grok-imagine-image-2.0',label:'Grok Image 2',kind:'image',aspectRatios:IMAGE_RATIOS,resolutions:['1K'],resolution:'1K',quality:'low',durations:[],unitUsd:0.04,sku:'output_image:low_1k',supportsReferenceImage:true,referenceUnitUsd:0.01},
  {id:'bytedance-seed/seedream-5-0-flash',label:'Seedream 5 Flash',kind:'image',aspectRatios:IMAGE_RATIOS,resolutions:['1K'],resolution:'1K',durations:[],unitUsd:0.018,sku:'output_image',supportsReferenceImage:true,referenceUnitUsd:0},
  {id:'x-ai/grok-imagine-video-1.5-lite',label:'Grok Video 1.5 Lite',kind:'video',aspectRatios:VIDEO_RATIOS,resolutions:['720p'],resolution:'720p',durations:Array.from({length:15},(_,i)=>i+1),unitUsd:0.03,sku:'cents_per_video_output_second_720p/100',supportsReferenceImage:true,referenceUnitUsd:0.01},
  {id:'alibaba/wan-3.0',label:'Wan 3.0',kind:'video',aspectRatios:['16:9','9:16','1:1','4:3','3:4'],resolutions:['720p'],resolution:'720p',durations:Array.from({length:29},(_,i)=>i+2),unitUsd:0.1,sku:'duration_seconds_720p',generateAudio:false,supportsReferenceImage:true,referenceUnitUsd:0},
  {id:'google/veo-3.1-lite',label:'Veo 3.1 Lite',kind:'video',aspectRatios:['16:9','9:16'],resolutions:['720p'],resolution:'720p',durations:[4,6,8],unitUsd:0.03,sku:'duration_seconds_without_audio_720p',generateAudio:false,supportsReferenceImage:true,referenceUnitUsd:0},
];
export type FrozenGenerationPolicy = {version:1; costMultiplier:3; creditsPerCny:100; usdToCny:number; modelId:string; resolution:string;
  quality?:string; duration?:number; unitUsd:number; estimatedUsd:number; maxUsd:number; estimatedCredits:number; maxCredits:number; sku:string; generateAudio?:boolean;referenceImages?:1;referenceUnitUsd?:number};
function costPolicy(fx:number):DzmmCreditCostPolicy {return {version:1,multiplier:3,usdToCny:fx,creditsPerCny:100,inputUsdPerMillion:1,outputUsdPerMillion:1,maxInputUsdPerMillion:1,maxOutputUsdPerMillion:1};}
export function generationCharge(cost:number,fx:number):number {return chargeDzmmProviderCostUsd(cost,costPolicy(fx));}
export function generationFx(env:{GENERATION_USD_TO_CNY?:string;CREDIT_BILLING_COST_POLICY_JSON?:string}):number|undefined {
  let value:unknown=env.GENERATION_USD_TO_CNY===undefined?undefined:Number(env.GENERATION_USD_TO_CNY);
  if(value===undefined){try{value=JSON.parse(env.CREDIT_BILLING_COST_POLICY_JSON||'{}').usdToCny;}catch{return undefined;}}
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1000||Math.round(value*1e6)/1e6!==value)return undefined;
  return value;
}
export function freezeGenerationPolicy(model:GenerationModel,duration:number|undefined,fx:number,referenceImages:0|1=0):FrozenGenerationPolicy {
  // Catalog precision here is six decimal places. Construct an exact decimal USD
  // estimate before the existing BigInt monetary ceiling; no binary 0.1*3 drift.
  const units=model.kind==='video'?duration!:1;
  if(referenceImages&&!model.supportsReferenceImage)throw new ApiError(400,'当前模型不支持参考图，请更换模型。');
  const estimatedUsd=Number((BigInt(Math.round(model.unitUsd*1e6))*BigInt(units)+BigInt(Math.round(model.referenceUnitUsd*1e6))*BigInt(referenceImages)).toString())/1e6;
  const maxUsd=Number((BigInt(Math.round(estimatedUsd*1e6))*BigInt(12)).toString())/1e7;
  const estimatedCredits=generationCharge(estimatedUsd,fx),maxCredits=generationCharge(maxUsd,fx);
  if(!Number.isSafeInteger(maxCredits)||maxCredits<1||maxCredits>1e9)throw new ApiError(400,'单次生成费用超过限制。');
  return {version:1,costMultiplier:3,creditsPerCny:100,usdToCny:fx,modelId:model.id,resolution:model.resolution,
    ...(model.quality?{quality:model.quality}:{}),...(duration!==undefined?{duration}:{}),...(model.generateAudio!==undefined?{generateAudio:model.generateAudio}:{}),
    unitUsd:model.unitUsd,estimatedUsd,maxUsd,estimatedCredits,maxCredits,sku:model.sku,...(referenceImages?{referenceImages:1,referenceUnitUsd:model.referenceUnitUsd}:{})};
}
export function readGenerationPolicy(raw:string):FrozenGenerationPolicy {
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new ApiError(503,'生成计价记录无效，请联系管理员。');}
  const fail=()=>new ApiError(503,'生成计价记录无效，请联系管理员。');
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail();const p=value as FrozenGenerationPolicy;
  const allowed=['version','costMultiplier','creditsPerCny','usdToCny','modelId','resolution','quality','duration','unitUsd','estimatedUsd','maxUsd','estimatedCredits','maxCredits','sku','generateAudio','referenceImages','referenceUnitUsd'];
  const model=GENERATION_MODELS.find(m=>m.id===p.modelId);
  if(Object.keys(value).some(key=>!allowed.includes(key))||!model||p.version!==1||p.costMultiplier!==3||p.creditsPerCny!==100
    ||typeof p.usdToCny!=='number'||generationFx({GENERATION_USD_TO_CNY:String(p.usdToCny)})===undefined||parseDzmmProviderCostUsd(p.unitUsd)===undefined||p.unitUsd<=0||p.unitUsd>1000
    ||Math.round(p.unitUsd*1e6)/1e6!==p.unitUsd||typeof p.sku!=='string'||!p.sku||p.sku.length>100||/[\x00-\x1f\x7f]/.test(p.sku)
    ||(p.referenceImages!==undefined?(p.referenceImages!==1||parseDzmmProviderCostUsd(p.referenceUnitUsd)===undefined||p.referenceUnitUsd!>1000||Math.round(p.referenceUnitUsd!*1e6)/1e6!==p.referenceUnitUsd):p.referenceUnitUsd!==undefined)
    ||(model.kind==='image'?(p.resolution!=='1K'||p.duration!==undefined||p.generateAudio!==undefined||(p.quality!==undefined&&p.quality!=='low'))
      :(p.resolution!=='720p'||!Number.isInteger(p.duration)||p.duration!<1||p.duration!>30||p.quality!==undefined||(p.generateAudio!==undefined&&p.generateAudio!==false))))throw fail();
  // Validate the historical snapshot internally, not against today's catalog
  // prices/SKU labels. A later price update must not strand an older paid job.
  const historical={...model,unitUsd:p.unitUsd,sku:p.sku,resolution:p.resolution,quality:p.quality,generateAudio:p.generateAudio,referenceUnitUsd:p.referenceUnitUsd??0,supportsReferenceImage:true};
  let expected:FrozenGenerationPolicy;try{expected=freezeGenerationPolicy(historical,p.duration,p.usdToCny,p.referenceImages??0);}catch{throw fail();}
  if(p.estimatedUsd!==expected.estimatedUsd||p.maxUsd!==expected.maxUsd||p.estimatedCredits!==expected.estimatedCredits||p.maxCredits!==expected.maxCredits)throw fail();
  return p;
}
export const OPENROUTER_ORIGIN='https://openrouter.ai';
export class ProviderRejected extends Error {}
export type GenerationFetch = (url:string,init?:RequestInit)=>Promise<Response>;
export async function providerJson(fetcher:GenerationFetch,key:string,path:string,body?:Record<string,unknown>):Promise<Record<string,unknown>> {
  const response=await fetcher(OPENROUTER_ORIGIN+'/api/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(body&&path==='images'?110_000:30_000)});
  if(!response.ok){if(response.status>=400&&response.status<500&&response.status!==408)throw new ProviderRejected('生成服务拒绝了本次请求。');throw new Error('Provider unavailable');}
  const text=await boundedText(response,24*1024*1024);
  const value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid provider response');
  return value as Record<string,unknown>;
}
export function providerCost(value:Record<string,unknown>):number|undefined {
  const usage=value.usage;if(!usage||typeof usage!=='object'||Array.isArray(usage))return undefined;
  const u=usage as Record<string,unknown>;return parseDzmmProviderCostUsd(u.cost??u.total_cost);
}
export async function boundedBytes(response:Response,maximum:number):Promise<Uint8Array>{
  if(!response.ok||response.status>=300||!response.body||Number(response.headers.get('Content-Length'))>maximum)throw new Error('Invalid generated asset');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{for(;;){const item=await reader.read();if(item.done)break;total+=item.value.byteLength;if(total>maximum){await reader.cancel();throw new Error('Asset too large');}chunks.push(item.value);}}
  finally{reader.releaseLock();}const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
async function boundedText(response:Response,max:number){return new TextDecoder().decode(await boundedBytes(response,max));}
export function assetType(bytes:Uint8Array,kind:GenerationKind):string {
  if(kind==='image'){
    if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&new TextDecoder().decode(bytes.subarray(12,16))==='IHDR'
      &&new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)>0&&new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)>0)return'image/png';
    if(bytes.length>=16&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return'image/jpeg';
    if(bytes.length>=20&&new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&new TextDecoder().decode(bytes.subarray(8,12))==='WEBP')return'image/webp';
  }else if(bytes.length>=24&&new TextDecoder().decode(bytes.subarray(4,8))==='ftyp')return'video/mp4';
  throw new Error('Invalid asset signature');
}
export async function imageBytes(value:Record<string,unknown>,fetcher:GenerationFetch):Promise<Uint8Array>{
  const item=Array.isArray(value.data)?value.data[0]:undefined;
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Missing generated image');
  const data=item as Record<string,unknown>,encoded=data.b64_json;
  if(typeof encoded==='string'){
    if(!encoded||encoded.length>28*1024*1024||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('Invalid image encoding');
    const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));if(bytes.length>20*1024*1024)throw new Error('Image too large');return bytes;
  }
  // Generated provider links are not caller supplied. Reject local addresses,
  // credentials, non-default ports and redirects before a public HTTPS download.
  if(typeof data.url!=='string')throw new Error('Missing image data');const url=new URL(data.url);
  const hostname=url.hostname.toLowerCase();
  const allowedHosts=['openrouter.ai','files.openrouter.ai','cdn.openrouter.ai','imgen.x.ai','storage.googleapis.com'];
  const providerCdn=['volces.com','byteimg.com'];
  if(url.protocol!=='https:'||url.username||url.password||url.port||(!allowedHosts.includes(hostname)&&!providerCdn.some(suffix=>hostname===suffix||hostname.endsWith('.'+suffix))))throw new Error('Unsafe image URL');
  return boundedBytes(await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(30_000)}),20*1024*1024);
}
