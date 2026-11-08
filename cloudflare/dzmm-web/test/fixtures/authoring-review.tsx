/** Real CharacterStudio with local callbacks; all API calls rejected. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import CharacterStudio from "../../../../src/components/dzmm/character-studio";
import { parseCharacterImport, type Character } from "../../../../src/lib/dzmm-characters";

const example = parseCharacterImport({
  name: "本地体验·修表师", description: "林澈，29岁，修表师。想在店关门前修好一只旧钟。",
  introduction: "展示介绍里的 {{displayOnly}} 不进入模型。", systemPrompt: "{{char}} 核对齿轮；{{getvar::trust}} 不执行。",
  openingMessages: [{role:"assistant",content:"你好。"},{role:"user",content:"我带来了旧钟。"},{role:"assistant",content:"先查看齿轮，还是找原图？"}],
  alternateGreetings:["雨停后，修表师把旧钟搬到窗边。"],
  characterBook:{entries:[
    {id:"clock",name:"旧钟",keys:["旧钟","{{char}}"],content:"旧钟缺少一枚齿轮。",selective:true,enabled:true},
    {id:"shop",name:"店铺",keys:[],content:"店铺每天傍晚关门。",constant:true,selective:true,enabled:true},
    {id:"off",name:"停用知识",keys:["{{off}}"],content:"{{off}}",selective:true,enabled:false}
  ]}
},"local-authoring-round7");
function App(){
  const [card,setCard]=useState<Character|null>(example),[key,setKey]=useState(0),[closed,setClosed]=useState(false),[dirty,setDirty]=useState(false),[saved,setSaved]=useState<Character|null>(null),[saves,setSaves]=useState(0),[requests,setRequests]=useState(0);
  useEffect(()=>{
    const previous=window.fetch;
    window.fetch=async()=>{setRequests(value=>value+1);throw new Error("本地创作验收禁止API请求");};
    return ()=>{window.fetch=previous;};
  },[]);
  function load(value:Character|null){setCard(value);setKey(value=>value+1);setClosed(false);setSaved(null);setSaves(0);setDirty(false);}
  return <><section className="fixture-controls" aria-label="本地验收控制台"><h1>创作检查 · 本地隔离验收</h1><button onClick={()=>load(example)}>加载多开场角色</button><button onClick={()=>load(null)}>加载仅名称草稿</button><pre role="status" aria-label="本地保存记录">{JSON.stringify({dirty,saves,requests,savedName:saved?.name??null,savedDescription:saved?.description??null,savedScenario:saved?.scenario??null,savedKeys:saved?Object.keys(saved):[],closed},null,2)}</pre></section>{!closed&&<CharacterStudio key={key} character={card} nickname="本地作者" user={{id:"local-user-round7",isGuest:false}} onClose={()=>setClosed(true)} onSave={value=>{setSaved(value);setSaves(count=>count+1);}} onTest={()=>{throw new Error("本轮不调用模型");}} onSubmit={async()=>{throw new Error("本轮不公开投稿");}} onDirtyChange={setDirty}/>}</>;
}
createRoot(document.getElementById("root")!).render(<App/>);
