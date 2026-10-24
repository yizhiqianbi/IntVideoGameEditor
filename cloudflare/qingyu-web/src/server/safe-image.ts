import { ContentError,reviewContent,type ModerationEnv } from "./policy";
export function imageSource(raw:string):URL {
 let url:URL;try{url=new URL(raw);}catch{throw new ContentError(400,"图片地址无效。");}
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
 if(url.protocol!=="https:"||url.username||url.password||url.port||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||!host.includes('.'))throw new ContentError(400,"图片需要使用公开的 HTTPS 地址。");
 return url;
}
export async function safeImage(request:Request,env:ModerationEnv,fetcher:typeof fetch=fetch){
 if(request.method!=="GET")throw new ContentError(405,"图片入口仅支持 GET。");
 const source=imageSource(new URL(request.url).searchParams.get("url")??"");
 let response:Response;try{response=await fetcher(source,{redirect:"manual",signal:AbortSignal.timeout(15000)});}catch{throw new ContentError(502,"无法读取这张图片。");}
 const type=response.headers.get('Content-Type')?.split(';')[0];
 if(!response.ok||!type||!["image/png","image/jpeg","image/webp"].includes(type)){await response.body?.cancel();throw new ContentError(400,"仅支持 PNG、JPEG 或 WebP 图片。");}
 const reader=response.body?.getReader();if(!reader)throw new ContentError(400,"图片内容为空。");
 const parts:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5*1024*1024){await reader.cancel();throw new ContentError(413,"图片不能超过 5MB。");}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 await reviewContent([{type:"image_url",image_url:{url:`data:${type};base64,${btoa(binary)}`}}],env,fetcher);
 return new Response(bytes,{headers:{"Content-Type":type,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
}
