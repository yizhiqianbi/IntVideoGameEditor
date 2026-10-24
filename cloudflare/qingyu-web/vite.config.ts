import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL(".",import.meta.url));
export default defineConfig({root,envDir:root,envPrefix:"QINGYU_PUBLIC_",plugins:[react()],resolve:{alias:{"@":`${root}/engine/src`},dedupe:["react","react-dom"]},server:{proxy:{"/api/":{target:"http://127.0.0.1:8796",changeOrigin:true,configure(proxy){proxy.on("proxyReq",(out,req)=>{if(req.headers.origin==="http://127.0.0.1:5186")out.setHeader("Origin","http://127.0.0.1:8796");});}},"/community-guidelines":"http://127.0.0.1:8796"}},build:{target:"es2022",sourcemap:false}});
