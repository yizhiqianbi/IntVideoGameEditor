"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DzmmAdminError, fetchDzmmAdminBanners, saveDzmmAdminBanner, updateDzmmAdminBanner, deleteDzmmAdminBanner, type DzmmAdminBanner } from "@/lib/dzmm-admin-client";
import {
  actOpsCharacter, deleteOpsOrientation, deleteOpsSubtag, fetchOpsAnalytics, fetchOpsCharacters, fetchOpsModelPrices,
  fetchOpsOrientations, fetchOpsPackages, fetchOpsRecharges, fetchOpsRejectReasons, fetchOpsReviews, fetchOpsScenePrices,
  fetchOpsSubtags, fetchOpsVoices, saveOpsCharacter, saveOpsModelPrice, saveOpsOrientation, saveOpsPackage, saveOpsScenePrice,
  saveOpsSubtag, saveOpsVoice, syncOpsVoices,
  type OpsCharacter, type OpsDay, type OpsModelPrice, type OpsOrientation, type OpsPackage, type OpsScenePrice, type OpsSubtag, type OpsVoice,
} from "@/lib/dzmm-ops-client";
import { reviewDzmmSubmission } from "@/lib/dzmm-publishing";
import s from "./admin-dashboard.module.css";

type View = "packages" | "prices" | "orientations" | "subtags" | "voices" | "characters" | "recharges" | "analytics" | "reviews" | "banners";
const VIEWS: { id: View; label: string }[] = [
  { id: "packages", label: "充值套餐" }, { id: "prices", label: "积分单价" }, { id: "orientations", label: "性向" },
  { id: "subtags", label: "子标签" }, { id: "voices", label: "语音" }, { id: "characters", label: "官方角色" },
  { id: "recharges", label: "充值记录" }, { id: "analytics", label: "数据看板" }, { id: "reviews", label: "审核队列" },
  { id: "banners", label: "横幅" },
];
const SCENE_LABEL: Record<string, string> = { suggestion: "建议回复（每千 token）", image: "图片（每次）", video: "视频（每次）", character: "创建角色（每次）", voice: "语音（每次）" };
const number = (value: number) => value.toLocaleString("zh-CN");
const money = (minor: number) => `¥${(minor / 100).toFixed(2)}`;
const when = (value: number | null) => value === null ? "—" : new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const blank = (value: number | null) => value === null ? "—" : `${value}`;
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";
let onOpsUnauthorized: (() => void) | null = null;
function report(error: unknown) {
  if (error instanceof DzmmAdminError && (error.status === 401 || error.status === 403)) onOpsUnauthorized?.();
  return message(error);
}
const today = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className={s.overviewSection}><h3>{title}</h3>{note ? <p>{note}</p> : null}{children}</section>;
}
function Notice({ value }: { value: string }) { return value ? <p className={s.notice} role="status">{value}</p> : null; }

export type OpsView = View;

export default function OpsConsole({ accountId, view: forced, onUnauthorized }: { accountId: string; view?: View; onUnauthorized?: () => void }) {
  const [view, setView] = useState<View>(forced ?? "packages");
  const current = forced ?? view;
  useEffect(() => { onOpsUnauthorized = onUnauthorized ?? null; return () => { onOpsUnauthorized = null; }; }, [onUnauthorized]);
  return <div>
    {forced ? null : <div className={s.filters} role="tablist" aria-label="运营功能">{VIEWS.map(item => <button type="button" key={item.id} className={current === item.id ? s.primary : s.outline} aria-current={current === item.id ? "page" : undefined} onClick={() => setView(item.id)}>{item.label}</button>)}</div>}
    {current === "packages" ? <Packages accountId={accountId} /> : null}
    {current === "prices" ? <Prices accountId={accountId} /> : null}
    {current === "orientations" ? <Orientations accountId={accountId} /> : null}
    {current === "subtags" ? <Subtags accountId={accountId} /> : null}
    {current === "voices" ? <Voices accountId={accountId} /> : null}
    {current === "characters" ? <Characters accountId={accountId} /> : null}
    {current === "recharges" ? <Recharges accountId={accountId} /> : null}
    {current === "analytics" ? <Analytics accountId={accountId} /> : null}
    {current === "reviews" ? <Reviews accountId={accountId} /> : null}
    {current === "banners" ? <Banners accountId={accountId} /> : null}
  </div>;
}

function Packages({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<OpsPackage[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [yuan, setYuan] = useState("28");
  const [credits, setCredits] = useState("2800");
  const [bonus, setBonus] = useState("0");
  const [ratio, setRatio] = useState("");
  const [weight, setWeight] = useState("10");
  const [enabled, setEnabled] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => { void fetchOpsPackages(accountId).then(setRows).catch(error => setNotice(report(error))); }, [accountId]);
  useEffect(() => { load(); }, [load]);
  function edit(row: OpsPackage) {
    setEditing(row.id); setYuan(String(row.amountMinor / 100)); setCredits(String(row.credits)); setBonus(String(row.bonusCredits));
    setRatio(row.bonusRatio); setWeight(String(row.weight)); setEnabled(row.enabled); setConfirmed(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) { setNotice("请勾选二次确认后再保存。"); return; }
    const amount = Number(yuan);
    if (!Number.isInteger(amount) || amount < 1 || amount > 2000) { setNotice("金额需要是 1 到 2000 的整数元。"); return; }
    try {
      await saveOpsPackage(accountId, editing, { amountMinor: amount * 100, credits: Number(credits), bonusCredits: Number(bonus), bonusRatio: ratio.trim(), weight: Number(weight), enabled });
      setNotice(editing ? "套餐已更新。已经支付的订单仍按当时的快照入账。" : "套餐已新增。到手积分若不能走现有支付档，用户端不会展示，保存本身不受影响。");
      setEditing(null); setConfirmed(false); load();
    } catch (error) { setNotice(report(error)); }
  }
  return <Panel title="充值套餐" note="用户端只展示已启用、并且当前支付通道能够入账的套餐，按权重从小到大。赠送比例由你手填。手续费还没配置，这里不计算净额。">
    <form className={s.filters} onSubmit={event => void save(event)}>
      <label>金额（元）<input value={yuan} inputMode="numeric" onChange={event => setYuan(event.target.value)} /></label>
      <label>到手积分<input value={credits} inputMode="numeric" onChange={event => setCredits(event.target.value)} /></label>
      <label>额外赠送<input value={bonus} inputMode="numeric" onChange={event => setBonus(event.target.value)} /></label>
      <label>赠送比例<input value={ratio} placeholder="13.64" onChange={event => setRatio(event.target.value)} /></label>
      <label>权重<input value={weight} inputMode="numeric" onChange={event => setWeight(event.target.value)} /></label>
      <label>启用<select value={enabled ? "1" : "0"} onChange={event => setEnabled(event.target.value === "1")}><option value="1">启用</option><option value="0">停用</option></select></label>
      <label>二次确认<input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /></label>
      <button className={s.primary} type="submit">{editing ? "保存修改" : "新增套餐"}</button>
      {editing ? <button className={s.outline} type="button" onClick={() => { setEditing(null); setConfirmed(false); }}>取消编辑</button> : null}
    </form>
    <Notice value={notice} />
    <div className={s.tableScroll}><table className={s.table}><thead><tr><th>套餐</th><th>金额</th><th>到手</th><th>赠送</th><th>比例</th><th>权重</th><th>状态</th><th>购买</th><th>入账</th><th></th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td><code>{row.id}</code></td><td>{money(row.amountMinor)}</td><td>{number(row.credits)}</td><td>{number(row.bonusCredits)}</td><td>{row.bonusRatio || "—"}</td><td>{row.weight}</td><td>{row.enabled ? "启用" : "停用"}</td><td>{number(row.purchases)}</td><td>{row.checkoutReady ? "可购买" : "仅保存"}</td><td><button className={s.text} type="button" onClick={() => edit(row)}>编辑</button></td></tr>)}</tbody></table></div>
  </Panel>;
}

function Prices({ accountId }: { accountId: string }) {
  const [scenes, setScenes] = useState<OpsScenePrice[]>([]);
  const [models, setModels] = useState<OpsModelPrice[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    void Promise.all([fetchOpsScenePrices(accountId), fetchOpsModelPrices(accountId)]).then(([nextScenes, nextModels]) => {
      setScenes(nextScenes); setModels(nextModels);
      setDrafts(Object.fromEntries([...nextScenes.map(row => [row.scene, String(row.amount)]), ...nextModels.map(row => [row.model, row.amount === null ? "" : String(row.amount)])]));
    }).catch(error => setNotice(report(error)));
  }, [accountId]);
  useEffect(() => { load(); }, [load]);
  async function saveScene(scene: string) {
    const amount = Number(drafts[scene]);
    if (!Number.isFinite(amount) || amount < 0) { setNotice("请填写有效单价。"); return; }
    try { setScenes(await saveOpsScenePrice(accountId, scene, amount)); setNotice("场景单价已保存。只记录给运营看，对话结算仍用环境统一费率，图片和视频的实际冻结仍走现有生成报价。"); }
    catch (error) { setNotice(report(error)); }
  }
  async function saveModel(row: OpsModelPrice) {
    const amount = Number(drafts[row.model]);
    if (!Number.isFinite(amount) || amount < 0) { setNotice("请填写有效模型单价。"); return; }
    try { setModels(await saveOpsModelPrice(accountId, row.model, row.intro, amount)); setNotice("模型单价已保存。历史扣费不会改写，当前聊天报价也不读取这张表。"); }
    catch (error) { setNotice(report(error)); }
  }
  return <Panel title="积分单价" note="建议回复按每千 token，可保留两位小数。图片、视频、创建角色和语音按每次整数积分，0 表示免费。创建角色按钮会在价格大于 0 时显示这次费用。">
    <Notice value={notice} />
    <div className={s.tableScroll}><table className={s.table}><thead><tr><th>场景</th><th>单价</th><th>版本</th><th></th></tr></thead><tbody>{scenes.map(row => <tr key={row.scene}><td>{SCENE_LABEL[row.scene] ?? row.scene}</td><td><input value={drafts[row.scene] ?? ""} onChange={event => setDrafts(value => ({ ...value, [row.scene]: event.target.value }))} /></td><td>{row.revision}</td><td><button className={s.text} type="button" onClick={() => void saveScene(row.scene)}>保存</button></td></tr>)}</tbody></table></div>
    <h3>模型目录</h3>
    <div className={s.tableScroll}><table className={s.table}><thead><tr><th>模型</th><th>介绍</th><th>每千 token</th><th></th></tr></thead><tbody>{models.map(row => <tr key={row.model}><td><strong>{row.name}</strong><span className={s.secondaryLine}>{row.model}</span></td><td><input value={row.intro} onChange={event => setModels(list => list.map(item => item.model === row.model ? { ...item, intro: event.target.value } : item))} /></td><td><input value={drafts[row.model] ?? ""} placeholder="未设置" onChange={event => setDrafts(value => ({ ...value, [row.model]: event.target.value }))} /></td><td><button className={s.text} type="button" onClick={() => void saveModel(row)}>保存</button></td></tr>)}</tbody></table></div>
  </Panel>;
}

function Orientations({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<OpsOrientation[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [explanation, setExplanation] = useState("");
  const [icon, setIcon] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => { void fetchOpsOrientations(accountId).then(setRows).catch(error => setNotice(report(error))); }, [accountId]);
  useEffect(() => { load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    try { await saveOpsOrientation(accountId, id, { name, explanation, icon }); setId(null); setName(""); setExplanation(""); setIcon(""); setNotice("性向已保存。"); load(); }
    catch (error) { setNotice(report(error)); }
  }
  async function remove(target: string) {
    if (!window.confirm("删除后新卡不能再选这个性向。已经写在角色上的记录会保留。")) return;
    try { await deleteOpsOrientation(accountId, target); setNotice("性向已软删除。"); load(); } catch (error) { setNotice(report(error)); }
  }
  return <Panel title="性向" note="列表按最近配置时间排。图标只接受 jpg。删除是软删除，需要再确认一次。">
    <form className={s.filters} onSubmit={event => void save(event)}>
      <label>名称<input value={name} maxLength={20} onChange={event => setName(event.target.value)} /></label>
      <label>解释<input value={explanation} maxLength={200} onChange={event => setExplanation(event.target.value)} /></label>
      <label>图标<input value={icon} placeholder="https://…jpg 或 /path.jpg" onChange={event => setIcon(event.target.value)} /></label>
      <button className={s.primary} type="submit">{id ? "保存" : "新增"}</button>
    </form>
    <Notice value={notice} />
    <ul>{rows.map(row => <li key={row.id}><strong>{row.name}</strong> {row.explanation} <button className={s.text} type="button" onClick={() => { setId(row.id); setName(row.name); setExplanation(row.explanation); setIcon(row.icon); }}>编辑</button> <button className={s.text} type="button" onClick={() => void remove(row.id)}>删除</button></li>)}</ul>
  </Panel>;
}

function Subtags({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<OpsSubtag[]>([]);
  const [orientations, setOrientations] = useState<OpsOrientation[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cardType, setCardType] = useState("tavern");
  const [orientationId, setOrientationId] = useState("");
  const [homeFilter, setHomeFilter] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    void Promise.all([fetchOpsSubtags(accountId), fetchOpsOrientations(accountId)]).then(([tags, next]) => { setRows(tags); setOrientations(next); if (!orientationId && next[0]) setOrientationId(next[0].id); }).catch(error => setNotice(report(error)));
  }, [accountId, orientationId]);
  useEffect(() => { load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await saveOpsSubtag(accountId, id, { name, homeFilter, ...(id ? {} : { cardType, orientationId }) });
      setId(null); setName(""); setNotice("子标签已保存。编辑不能改角色类型和性向。"); load();
    } catch (error) { setNotice(report(error)); }
  }
  async function remove(target: string) {
    if (!window.confirm("删除后筛选里不再出现。历史角色卡仍保留原标签。")) return;
    try { await deleteOpsSubtag(accountId, target); load(); } catch (error) { setNotice(report(error)); }
  }
  return <Panel title="子标签" note="按角色类型和性向归类。勾选首页筛选项后，会出现在目录筛选接口里。">
    <form className={s.filters} onSubmit={event => void save(event)}>
      <label>名称<input value={name} maxLength={16} onChange={event => setName(event.target.value)} /></label>
      <label>类型<select value={cardType} disabled={Boolean(id)} onChange={event => setCardType(event.target.value)}><option value="tavern">幻想剧场</option><option value="companion">心动陪伴</option></select></label>
      <label>性向<select value={orientationId} disabled={Boolean(id)} onChange={event => setOrientationId(event.target.value)}>{orientations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>首页筛选<input type="checkbox" checked={homeFilter} onChange={event => setHomeFilter(event.target.checked)} /></label>
      <button className={s.primary} type="submit">{id ? "保存" : "新增"}</button>
    </form>
    <Notice value={notice} />
    <ul>{rows.map(row => <li key={row.id}><strong>{row.name}</strong> {row.cardType === "companion" ? "心动陪伴" : "幻想剧场"} · {row.orientationName}{row.homeFilter ? " · 首页" : ""} <button className={s.text} type="button" onClick={() => { setId(row.id); setName(row.name); setCardType(row.cardType); setOrientationId(row.orientationId); setHomeFilter(row.homeFilter); }}>编辑</button> <button className={s.text} type="button" onClick={() => void remove(row.id)}>删除</button></li>)}</ul>
  </Panel>;
}

function Voices({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<OpsVoice[]>([]);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => { void fetchOpsVoices(accountId).then(setRows).catch(error => setNotice(report(error))); }, [accountId]);
  useEffect(() => { load(); }, [load]);
  async function sync() {
    try { setRows(await syncOpsVoices(accountId)); setNotice("已从内置音色目录补齐缺失项，已有编辑不会被覆盖。"); } catch (error) { setNotice(report(error)); }
  }
  async function save(row: OpsVoice) {
    try { await saveOpsVoice(accountId, row.id, { gender: row.gender, intro: row.intro, previewUrl: row.previewUrl, enabled: row.enabled }); setNotice("语音已保存。"); load(); }
    catch (error) { setNotice(report(error)); }
  }
  return <Panel title="语音" note="先同步厂商目录，再改性别、介绍、试听和启用。0 积分的语音场景表示新的调用免费，已经发生的不计。">
    <button className={s.outline} type="button" onClick={() => void sync()}>同步音色</button>
    <Notice value={notice} />
    <div className={s.tableScroll}><table className={s.table}><thead><tr><th>音色</th><th>类型</th><th>介绍</th><th>试听</th><th>启用</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
      <td><code>{row.id}</code></td>
      <td><select value={row.gender} onChange={event => setRows(list => list.map(item => item.id === row.id ? { ...item, gender: event.target.value as OpsVoice["gender"] } : item))}><option value="female">女声</option><option value="male">男声</option></select></td>
      <td><input value={row.intro} onChange={event => setRows(list => list.map(item => item.id === row.id ? { ...item, intro: event.target.value } : item))} /></td>
      <td><input value={row.previewUrl} onChange={event => setRows(list => list.map(item => item.id === row.id ? { ...item, previewUrl: event.target.value } : item))} /></td>
      <td><input type="checkbox" checked={row.enabled} onChange={event => setRows(list => list.map(item => item.id === row.id ? { ...item, enabled: event.target.checked } : item))} /></td>
      <td><button className={s.text} type="button" onClick={() => void save(row)}>保存</button></td>
    </tr>)}</tbody></table></div>
  </Panel>;
}

function Characters({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<OpsCharacter[]>([]);
  const [orientations, setOrientations] = useState<OpsOrientation[]>([]);
  const [status, setStatus] = useState("");
  const [cardType, setCardType] = useState("tavern");
  const [name, setName] = useState("");
  const [orientationId, setOrientationId] = useState("");
  const [story, setStory] = useState("");
  const [opening, setOpening] = useState("");
  const [extra, setExtra] = useState({ scene: "", core: "", aiName: "", replyStyle: "", cover: "", suggestions: [] as string[], gallery: [] as string[], voiceId: "", tags: [] as string[], subtagIds: [] as string[] });
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    void Promise.all([fetchOpsCharacters(accountId, params.size ? `?${params}` : ""), fetchOpsOrientations(accountId)]).then(([cards, next]) => { setRows(cards); setOrientations(next); }).catch(error => setNotice(report(error)));
  }, [accountId, status]);
  useEffect(() => { load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) { setNotice("请勾选二次确认。新建官方卡默认下架，编辑不会改变上架状态。"); return; }
    try {
      await saveOpsCharacter(accountId, editing, { name, cardType, orientationId: orientationId || null, story, opening, ...extra });
      setNotice(editing ? "角色已更新，上架状态没变。" : "官方角色已创建，当前是下架。上架后才会进公开目录。");
      setEditing(null); setConfirmed(false); setName(""); setStory(""); setOpening("");
      setExtra({ scene: "", core: "", aiName: "", replyStyle: "", cover: "", suggestions: [], gallery: [], voiceId: "", tags: [], subtagIds: [] });
      load();
    } catch (error) { setNotice(report(error)); }
  }
  async function act(id: string, action: "list" | "unlist" | "delete") {
    const label = action === "list" ? "上架" : action === "unlist" ? "下架" : "删除";
    if (!window.confirm(action === "delete" ? "软删除后不能恢复。公开列表不再出现，历史聊天不会被清掉。" : `${label}这张官方角色？下架只影响公开可见，不清理相册，也不中断已有聊天。`)) return;
    try { await actOpsCharacter(accountId, id, action); setNotice(`已${label}。`); load(); } catch (error) { setNotice(report(error)); }
  }
  return <Panel title="官方角色" note="新建默认下架。上架后并入公开目录，作者显示为叙梦官方。下架只从公开列表拿掉。">
    <form className={s.filters} onSubmit={event => void save(event)}>
      <label>状态<select value={status} onChange={event => setStatus(event.target.value)}><option value="">未删除</option><option value="listed">已上架</option><option value="unlisted">已下架</option><option value="deleted">已删除</option></select></label>
      <label>名称<input value={name} maxLength={40} onChange={event => setName(event.target.value)} /></label>
      <label>类型<select value={cardType} onChange={event => setCardType(event.target.value)}><option value="tavern">幻想剧场</option><option value="companion">心动陪伴</option></select></label>
      <label>性向<select value={orientationId} onChange={event => setOrientationId(event.target.value)}><option value="">不指定</option>{orientations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>故事<input value={story} onChange={event => setStory(event.target.value)} /></label>
      <label>开场<input value={opening} onChange={event => setOpening(event.target.value)} /></label>
      <label>二次确认<input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /></label>
      <button className={s.primary} type="submit">{editing ? "保存修改" : "新建下架卡"}</button>
    </form>
    <Notice value={notice} />
    <ul>{rows.map(row => <li key={row.id}><strong>{row.name}</strong> {row.cardType === "companion" ? "心动陪伴" : "幻想剧场"} · {row.status === "listed" ? "已上架" : row.status === "unlisted" ? "已下架" : "已删除"} <code>{row.id}</code> {row.status !== "deleted" ? <><button className={s.text} type="button" onClick={() => { setEditing(row.id); setName(row.name); setCardType(row.cardType); setOrientationId(row.orientationId ?? ""); setStory(row.story ?? ""); setOpening(row.opening ?? ""); setExtra({ scene: row.scene ?? "", core: row.core ?? "", aiName: row.aiName ?? "", replyStyle: row.replyStyle ?? "", cover: row.cover ?? "", suggestions: row.suggestions ?? [], gallery: row.gallery ?? [], voiceId: row.voiceId ?? "", tags: row.tags ?? [], subtagIds: row.subtagIds ?? [] }); setConfirmed(false); }}>编辑</button> <button className={s.text} type="button" onClick={() => void act(row.id, row.status === "listed" ? "unlist" : "list")}>{row.status === "listed" ? "下架" : "上架"}</button> <button className={s.text} type="button" onClick={() => void act(row.id, "delete")}>删除</button></> : null}</li>)}</ul>
  </Panel>;
}

function Recharges({ accountId }: { accountId: string }) {
  const [userId, setUserId] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [channels, setChannels] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchOpsRecharges>> | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback((query: { userId?: string; orderNo?: string; channels?: string; from?: string; to?: string }) => {
    void fetchOpsRecharges(accountId, query).then(setData).catch(error => setNotice(report(error)));
  }, [accountId]);
  useEffect(() => { load({}); }, [load]);
  function submit(event: FormEvent) {
    event.preventDefault();
    load({ userId: userId.trim(), orderNo: orderNo.trim(), channels, from: from ? String(Date.parse(`${from}:00+08:00`)) : "", to: to ? String(Date.parse(`${to}:00+08:00`)) : "" });
  }
  return <Panel title="充值记录" note={data?.feeNote || "手续费尚未配置，金额是用户实付。"}>
    <dl className={s.metrics}><div><dt>累计实付</dt><dd>{money(data?.totals.all ?? 0)}</dd></div><div><dt>本月</dt><dd>{money(data?.totals.month ?? 0)}</dd></div><div><dt>本周</dt><dd>{money(data?.totals.week ?? 0)}</dd><span>周一起算，北京时间</span></div><div><dt>今日</dt><dd>{money(data?.totals.day ?? 0)}</dd></div></dl>
    <form className={s.filters} onSubmit={submit}>
      <label>用户 ID<input value={userId} onChange={event => setUserId(event.target.value)} /></label>
      <label>展示订单号<input value={orderNo} maxLength={12} onChange={event => setOrderNo(event.target.value)} /></label>
      <label>渠道<select value={channels} onChange={event => setChannels(event.target.value)}><option value="">全部</option><option value="wxpay">微信</option><option value="alipay">支付宝</option><option value="wxpay,alipay">微信和支付宝</option></select></label>
      <label>从<input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>到<input type="datetime-local" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button className={s.outline} type="submit">查询</button>
    </form>
    <Notice value={notice} />
    <div className={s.tableScroll}><table className={s.table}><thead><tr><th>用户</th><th>订单号</th><th>类型</th><th>币种</th><th>渠道</th><th>实付</th><th>积分</th><th>支付时间</th></tr></thead>
      <tbody>{data?.items.map(item => <tr key={item.id}><td><code>{item.userId}</code><span className={s.secondaryLine}>{item.nickname}</span></td><td>{item.publicNo}</td><td>{item.kind}</td><td>{item.currency}</td><td>{item.channel}</td><td>{money(item.amountMinor)}</td><td>{number(item.credits)}</td><td>{when(item.paidAt)}</td></tr>)}</tbody></table></div>
  </Panel>;
}

function Analytics({ accountId }: { accountId: string }) {
  const [from, setFrom] = useState(() => { const end = today(); return new Date(Date.parse(`${end}T00:00:00+08:00`) - 6 * 86400000 + 8 * 3600000).toISOString().slice(0, 10); });
  const [to, setTo] = useState(today);
  const [note, setNote] = useState("");
  const [balance, setBalance] = useState({ total: 0, users: 0, perUser: 0 });
  const [days, setDays] = useState<OpsDay[]>([]);
  const [notice, setNotice] = useState("");
  const load = useCallback((start: string, end: string) => {
    void fetchOpsAnalytics(accountId, start, end).then(value => { setNote(value.note); setBalance(value.balance); setDays(value.days); }).catch(error => setNotice(report(error)));
  }, [accountId]);
  useEffect(() => { load(from, to); }, [load, from, to]);
  return <Panel title="数据看板" note={note}>
    <form className={s.filters} onSubmit={event => { event.preventDefault(); load(from, to); }}>
      <label>从<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>到<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      <button className={s.outline} type="submit">查看</button>
    </form>
    <p>当前可用积分合计 {number(balance.total)}，有余额的账号 {number(balance.users)}，人均 {balance.perUser}。没有打点的格子显示为空。角色类型拆分还没有单独的看板。</p>
    <Notice value={notice} />
    <div className={s.tableScroll}><table className={s.table}><thead><tr>{["日期", "新用户", "新游客", "DAU", "注册率", "首聊率", "D1", "D7", "对话", "图片", "视频", "发放", "签到积分", "邀请积分", "消耗", "消耗比", "签到人数", "邀请绑定"].map(header => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{days.map(day => <tr key={day.day}><td>{day.day.slice(5)}</td><td>{day.newUsers}</td><td>{day.newGuests}</td><td>{day.dau}</td><td>{blank(day.registerRate)}</td><td>{blank(day.firstChatRate)}</td><td>{blank(day.d1Retention)}</td><td>{blank(day.d7Retention)}</td><td>{day.chatters}</td><td>{day.images}</td><td>{day.videos}</td><td>{day.creditsIssued}</td><td>{day.checkinCredits}</td><td>{day.inviteCredits}</td><td>{day.creditsSpent}</td><td>{blank(day.spendRatio)}</td><td>{day.checkins}</td><td>{day.inviteBinds}</td></tr>)}</tbody></table></div>
  </Panel>;
}

function Reviews({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(0);
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchOpsReviews>>["items"]>([]);
  const [reasons, setReasons] = useState<{ id: string; label: string }[]>([]);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    void Promise.all([fetchOpsReviews(accountId, status, q), fetchOpsRejectReasons(accountId)]).then(([page, next]) => {
      setPending(page.pending); setItems(page.items); setReasons(next); if (!reason && next[0]) setReason(next[0].label);
    }).catch(error => setNotice(report(error)));
  }, [accountId, q, reason, status]);
  useEffect(() => { load(); }, [load]);
  async function decide(id: string, version: number, decision: "approved" | "rejected") {
    try {
      await reviewDzmmSubmission(id, version, decision, decision === "rejected" ? reason : "", accountId);
      setNotice(decision === "approved" ? "已通过，角色进入原有公开流程。" : "已拒绝。");
      load();
    } catch (error) { setNotice(report(error)); }
  }
  return <Panel title="用户角色审核" note={`待审核 ${pending}。通过和拒绝走原来的审核接口。拒绝原因从目录里选。`}>
    <form className={s.filters} onSubmit={event => { event.preventDefault(); load(); }}>
      <label>状态<select value={status} onChange={event => setStatus(event.target.value)}><option value="pending">审核中</option><option value="approved">已通过</option><option value="rejected">已拒绝</option><option value="withdrawn">已撤回</option><option value="all">全部</option></select></label>
      <label>搜索<input value={q} onChange={event => setQ(event.target.value)} /></label>
      <label>拒绝原因<select value={reason} onChange={event => setReason(event.target.value)}>{reasons.map(item => <option key={item.id}>{item.label}</option>)}</select></label>
      <button className={s.outline} type="submit">刷新</button>
    </form>
    <Notice value={notice} />
    <ul>{items.map(item => <li key={item.id}><strong>{item.name || "未命名"}</strong> {item.label} · {item.author} <span className={s.secondaryLine}>{when(item.createdAt)}</span> {item.status === "pending" ? <><button className={s.text} type="button" onClick={() => void decide(item.id, item.publicationVersion, "approved")}>通过</button> <button className={s.text} type="button" onClick={() => void decide(item.id, item.publicationVersion, "rejected")}>拒绝</button></> : item.reason ? <span>原因：{item.reason}</span> : null}</li>)}</ul>
  </Panel>;
}

function Banners({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<DzmmAdminBanner[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [audience, setAudience] = useState<DzmmAdminBanner["audience"]>("general");
  const [position, setPosition] = useState("1");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [desktopImage, setDesktopImage] = useState("");
  const [mobileImage, setMobileImage] = useState("");
  const [orientationId, setOrientationId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const load = useCallback(() => { void fetchDzmmAdminBanners(accountId).then(setRows).catch(error => setNotice(report(error))); }, [accountId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 1500); return () => clearTimeout(timer); }, [notice]);
  function fill(row: DzmmAdminBanner) {
    setEditing(row.id); setAudience(row.audience); setPosition(String(row.position)); setTitle(row.title); setBody(row.body);
    setHref(row.href ?? ""); setDesktopImage(row.desktopImage ?? ""); setMobileImage(row.mobileImage ?? ""); setOrientationId(row.orientationId ?? ""); setEnabled(row.enabled !== false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const slot = Number(position);
    const input = { audience, position: slot, title: title.trim(), body: body.trim(), href: href.trim(), desktopImage, mobileImage, orientationId, enabled };
    try {
      if (editing) await updateDzmmAdminBanner(accountId, editing, input);
      else await saveDzmmAdminBanner(accountId, input);
      setNotice("横幅已保存"); setEditing(null); load();
    } catch (error) { setNotice(error instanceof DzmmAdminError ? report(error) : "保存失败。"); }
  }
  async function remove(id: string) {
    try { await deleteDzmmAdminBanner(accountId, id); setNotice("横幅已删除"); load(); } catch (error) { setNotice(report(error)); }
  }
  return <Panel title="首页横幅" note="同一展示位置全局只能有一条未删除横幅，停用的也占位置。编号小的排在前面。停用后首页不显示。图片只接受 jpg。标题和说明仍然必填。">
    <form className={s.filters} onSubmit={event => void save(event)}>
      <label>受众<select value={audience} onChange={event => setAudience(event.target.value as DzmmAdminBanner["audience"])}><option value="general">通用</option><option value="male">男性向</option><option value="female">女性向</option></select></label>
      <label>位置<input value={position} inputMode="numeric" onChange={event => setPosition(event.target.value)} /></label>
      <label>标题<input value={title} maxLength={40} onChange={event => setTitle(event.target.value)} /></label>
      <label>说明<input value={body} maxLength={120} onChange={event => setBody(event.target.value)} /></label>
      <label>链接<input value={href} onChange={event => setHref(event.target.value)} /></label>
      <label>电脑图<input value={desktopImage} onChange={event => setDesktopImage(event.target.value)} /></label>
      <label>手机图<input value={mobileImage} onChange={event => setMobileImage(event.target.value)} /></label>
      <label>性向 ID<input value={orientationId} onChange={event => setOrientationId(event.target.value)} /></label>
      <label>启用<select value={enabled ? "1" : "0"} onChange={event => setEnabled(event.target.value === "1")}><option value="1">启用</option><option value="0">停用</option></select></label>
      <button className={s.primary} type="submit">{editing ? "保存修改" : "新增横幅"}</button>
    </form>
    <Notice value={notice} />
    <ul>{rows.map(row => <li key={row.id}><strong>{row.deletedAt ? "已删除" : row.enabled === false ? "停用" : "启用"} · {row.position}</strong> {row.title} {row.body} {row.deletedAt ? null : <><button className={s.text} type="button" onClick={() => fill(row)}>编辑</button> <button className={s.text} type="button" onClick={() => void remove(row.id)}>删除</button></>}</li>)}</ul>
  </Panel>;
}
