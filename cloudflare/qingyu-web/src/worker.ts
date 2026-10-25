import {localNativeBinding,type LocalNativeEnv} from "./server/local-native-binding";
import {editionBoundary} from "./server/edition-boundary";
import {requireReviewSession} from "./server/review-session";
import {reviewCompanionResponse} from "./server/companion-review";
import {safeImage} from "./server/safe-image";
import { fetchRequest as webFetch, type Env as WebEnv } from "../engine/cloudflare/dzmm-web/src/worker";
import { fetchRequest as backendFetch } from "../engine/cloudflare/dzmm/src/app";
import { BillingService } from "../engine/cloudflare/dzmm/src/billing-service";
import type { Env as BackendEnv } from "../engine/cloudflare/dzmm/src/types";
import { ContentError,checkLocalContent,contentText,reviewContent,reviewReady,moderatedProviderFetch,type ModerationEnv } from "./server/policy";
export { BillingService } from "../engine/cloudflare/dzmm/src/billing-service";
export { ViduLiveStudio } from "../engine/cloudflare/dzmm-web/src/vidu-live-studio";
export { ViduVoiceService } from "../engine/cloudflare/dzmm-web/src/vidu-voice-service";
interface Env extends WebEnv,BackendEnv,ModerationEnv,LocalNativeEnv {
 CHAT_BASE_URL?:string;CHAT_API_KEY?:string;CHAT_MODEL?:string;
}
const mutation=new Set(["POST","PUT","PATCH"]);
async function contentGate(request:Request,env:Env) {
 const path=new URL(request.url).pathname.replace("/api/dzmm/backend/","/api/backend/");
 if(!mutation.has(request.method))return;
 const content=/\/api\/(?:backend\/v1\/(?:state|characters|conversations|preferences|forum|publishing|community|novels|games|scenarios|task-market|character-voice|chat-media|generation)|chat|memory|novel|reply-suggestions|dzmm\/(?:chat|memory|scenario|novel)|qingyu\/companion)/.test(path);
 if(content&&request.headers.get("Content-Type")?.includes("application/json")){
  if(Number(request.headers.get("Content-Length")??0)>16_777_216)throw new ContentError(413,"请求过大。");
  const text=await request.clone().text();if(text.length>16_777_216)throw new ContentError(413,"请求过大。");
  let body:unknown;try{body=JSON.parse(text);}catch{throw new ContentError(400,"请求格式无效。");}
  checkLocalContent(body);
  // Review free-form persisted content when connected. Public publishing and
  // native companion writes always require review before crossing the boundary.
  const publicWrite = /\/forum\/(?:posts|replies)|\/publishing\/(?:submissions|characters)|\/community(?:\/|$)|\/qingyu\/companion/.test(path);
  const persistedContent = /\/api\/backend\/v1\/(?:state|characters|conversations|preferences|novels|games|scenarios|task-market)/.test(path);
  const reviewText = contentText(body);
  if (reviewText.trim() && (publicWrite || (persistedContent && reviewReady(env)))) {
   await requireReviewSession(request,r=>backendFetch(r,env));
   await reviewContent(reviewText,env);
  }
 }
 if((path.endsWith("/media")||path.endsWith("/references"))&&request.method==="POST"){
  const type=request.headers.get("Content-Type")??"";
  if(!["image/png","image/jpeg","image/webp"].includes(type))return;
  await requireReviewSession(request,r=>backendFetch(r,env));
  const bytes=new Uint8Array(await request.clone().arrayBuffer());if(bytes.byteLength>5*1024*1024)throw new ContentError(413,"封面不能超过 5MB。");
  let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  await reviewContent([{type:"image_url",image_url:{url:`data:${type};base64,${btoa(binary)}`}}],env);
 }
}
export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
  const path=new URL(request.url).pathname;
  let dispatched=false;
  try{
   const unavailable=await editionBoundary(request);if(unavailable)return unavailable;
   if(path==="/api/qingyu/image")return await safeImage(request,env);
   if(path==="/api/status")return Response.json({brand:"晴屿",edition:"otome-simple",policy:"all-ages",configured:Boolean(env.CHAT_API_KEY&&env.CHAT_MODEL&&reviewReady(env))});
   const origin=request.headers.get("Origin");if(mutation.has(request.method)&&origin&&origin!==new URL(request.url).origin)return Response.json({error:"不支持跨站写入。"},{status:403});
   await contentGate(request,env);
   if(path.startsWith("/art/")||path.startsWith("/assets/qingyu/")||path==="/mark.svg")return env.ASSETS.fetch(request);
   const backendEnv={...env,APP_ORIGINS:"https://qingyu-backend.internal",GENERATION_ENABLED:"false",PAYMENTS_ACCEPTING_ENABLED:"false",SUBSCRIPTION_ENABLED:"false",NOWPAYMENTS_ENABLED:"false",CREDIT_BILLING_ENABLED:"false"};
   const backend={fetch:async(input:RequestInfo|URL,init?:RequestInit)=>backendFetch(input instanceof Request&&!init?input:new Request(input,init),backendEnv)};
   const combined={...env,COMPANION:env.COMPANION??localNativeBinding(env,request.url),BACKEND:backend,BILLING:new BillingService(ctx,backendEnv),DZMM_API_KEY:reviewReady(env)?env.CHAT_API_KEY:undefined,DZMM_BASE_URL:env.CHAT_BASE_URL,DZMM_MODEL:env.CHAT_MODEL,GENERATION_ENABLED:"false"} as unknown as WebEnv;
   dispatched=true;
   const response=await webFetch(request,combined,{providerFetch:moderatedProviderFetch(env),waitUntil:p=>ctx.waitUntil(p)});
   if (path.includes("/qingyu/companion")) {
    const accountId = response.headers.get("X-Qingyu-Companion-Owner");
    const profile = response.headers.get("X-Qingyu-Companion-Profile");
    await reviewCompanionResponse(response,env,fetch,accountId && (profile === "classic" || profile === "intimate" || profile === "traveler") ? {accountId,profile} : undefined);
    const headers = new Headers(response.headers);
    headers.delete("X-Qingyu-Companion-Owner");headers.delete("X-Qingyu-Companion-Profile");
    return new Response(response.body,{status:response.status,headers});
   }
   return response;
  }catch(error){return Response.json({error:error instanceof ContentError?error.message:"晴屿服务暂时不可用，请稍后重试。",...(!dispatched&&error instanceof ContentError&&mutation.has(request.method)&&path.includes('/qingyu/companion')?{code:'CONTENT_NOT_SENT'}:{})},{status:error instanceof ContentError?error.status:503,headers:{"Cache-Control":"no-store"}});}
 }
};
