import { useState } from "react";
import { createRoot } from "react-dom/client";
import LiveStudio from "../../../../src/components/dzmm/live-studio";
import tavern from "../../../../src/components/dzmm/tavern.module.css";
const initial = "qa-live-a";
document.cookie = `qingyu_session=${initial}; Path=/; SameSite=Lax`;
function Fixture() {
  const [id, setId] = useState(initial), [busy, setBusy] = useState(false), [back, setBack] = useState(false);
  function change(next: string) { document.cookie = next === "qa-guest" ? "qingyu_session=; Path=/; Max-Age=0" : `qingyu_session=${next}; Path=/; SameSite=Lax`; setId(next); setBack(false); }
  return <><aside className="fixture-panel" aria-label="原创实时影像隔离控制"><span>只有原创夹具；真实协议与网关，Vidu/RTC 全部本地模拟。</span><button onClick={() => change(id === "qa-live-a" ? "qa-live-b" : "qa-live-a")}>切换测试账号 A / B</button><button onClick={() => change("qa-guest")}>注销测试账号</button><button onClick={() => change("qa-live-super")}>切换模拟 Super</button><button onClick={() => void fetch("/fixture/fail-execute", { method: "POST" })}>切换持续表演故障</button><output>账号 {id} · {busy ? "忙碌" : "空闲"} · {back ? "已返回" : "工作台"}</output></aside><div className={tavern.app}>{!back && <LiveStudio key={id} userId={id === "qa-guest" ? undefined : id} isGuest={id === "qa-guest"} isSuper={id === "qa-live-super"} onRequireAccount={() => {}} onBack={() => setBack(true)} onBusyChange={setBusy} />}</div></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
