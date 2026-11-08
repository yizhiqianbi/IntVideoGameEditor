import { useState } from "react";
import { createRoot } from "react-dom/client";
import GenerationStudio from "../../../../src/components/dzmm/generation-studio";
import LiveStudio from "../../../../src/components/dzmm/live-studio";
import styles from "../../../../src/components/dzmm/tavern.module.css";
import "../../src/page.css";
function Fixture() {
  const [view,setView] = useState(location.hash === "#live" ? "live" : "generation");
  const [second,setSecond] = useState(false);
  const id=second ? "qa-ref-b" : "qa-ref-a";
  document.cookie=`qa_account=${id}; Path=/; SameSite=Lax`;
  return <><nav className="qa"><b>原创本地隔离验收 · 不调用模型</b><button onClick={()=>{setView("generation");location.hash="generation";}}>生成工作台</button><button onClick={()=>{setView("live");location.hash="live";}}>直播界面</button><button onClick={()=>setSecond(v=>!v)}>切换测试账号</button><span>{id}</span></nav><div className={styles.app}>{view === "generation" ? <GenerationStudio key={id} userId={id} isGuest={false} onRequireAccount={()=>{}} onRecharge={()=>{}}/> : <LiveStudio key={id} userId={id} isGuest={false} isSuper={!second} onRequireAccount={()=>{}} onBack={()=>setView("generation")}/>}</div></>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
