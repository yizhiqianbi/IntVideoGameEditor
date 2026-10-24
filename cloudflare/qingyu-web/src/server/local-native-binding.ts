/** Local development only. Production continues using the private Cloudflare binding. */
export interface LocalNativeEnv {COMPANION_LOCAL_URL?:string;COMPANION_LOCAL_TOKEN?:string;COMPANION_LOCAL_MODE?:string}
export function localNativeBinding(env:LocalNativeEnv,requestUrl:string){
 if(env.COMPANION_LOCAL_MODE!=='true'||!env.COMPANION_LOCAL_URL||!env.COMPANION_LOCAL_TOKEN||env.COMPANION_LOCAL_TOKEN.length<32)return undefined;
 const origin=new URL(requestUrl),base=new URL(env.COMPANION_LOCAL_URL);
 if(!['127.0.0.1','localhost'].includes(origin.hostname)||base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.username||base.password||base.search||base.hash||base.pathname!=='/')return undefined;
 return {async fetch(input:RequestInfo|URL,init?:RequestInit){
  const request=input instanceof Request&&!init?input:new Request(input,init);const url=new URL(request.url);
  if(url.hostname!=='companion.internal'||!url.pathname.startsWith('/api/')||url.search)throw new Error('Invalid private companion route');
  const headers=new Headers(request.headers);headers.set('Authorization',`Bearer ${env.COMPANION_LOCAL_TOKEN}`);
  return fetch(base.origin+url.pathname,{method:request.method,headers,redirect:'manual',signal:request.signal,...(request.body?{body:await request.arrayBuffer()}: {})});
 }};
}
