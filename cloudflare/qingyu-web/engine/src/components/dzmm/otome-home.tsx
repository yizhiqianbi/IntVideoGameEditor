import {useState} from "react";
import type {Character} from "@/lib/dzmm-characters";
import type {DzmmPreferences} from "@/lib/dzmm-storage";
import type {DzmmAuthor} from "@/lib/dzmm-discovery";
import {QINGYU_CHARACTERS} from "@/lib/qingyu-catalog";
import Icon from "./icons";
import s from "./otome-home.module.css";
type Props={characters:Character[];favorites:string[];likes:string[];preferences:DzmmPreferences;authors:DzmmAuthor[];onCharacter:(c:Character)=>void;onStart:(c:Character)=>void;onFavorite:(id:string)=>void;onLike:(id:string)=>void;onAuthor:(a:DzmmAuthor)=>void;onNavigate:(view:"chat"|"live"|"novels"|"studio"|"voice"|"presets")=>void;onImport:()=>void};
export default function OtomeHome(p:Props){
 const [selected,setSelected]=useState(()=>{try{const saved=localStorage.getItem("qingyu-background-character");const index=QINGYU_CHARACTERS.findIndex(c=>c.id===saved);return index<0?0:index;}catch{return 0;}});
 function selectCharacter(index:number){setSelected(index);try{localStorage.setItem("qingyu-background-character",QINGYU_CHARACTERS[index].id);}catch{/* Background changes remain usable without browser storage. */}}const [tab,setTab]=useState("全部相遇");const [search,setSearch]=useState("");
 const featured=QINGYU_CHARACTERS[selected];
 const cards=p.characters.filter(c=>(tab!=="我的收藏"||p.favorites.includes(c.id))&&`${c.name} ${c.description} ${c.tags.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
 const rankValue=(c:Character)=>Number.parseFloat(String(c.heat).replace(/[^\d.]/g,""))||Number(c.siteLikeCount)||0;
 const ranking=[...cards].sort((a,b)=>tab==="最新相遇"?Date.parse(b.createdAt)-Date.parse(a.createdAt):rankValue(b)-rankValue(a));
 return <div className={s.home}>
  <section className={s.hero} aria-label="开始故事探险">
   <div className={s.heroBackdrop} key={featured.id}><img src={featured.cover} alt={`${featured.name}的原创立绘`} fetchPriority="high"/></div>
   <span className={s.orbit} aria-hidden="true"/>
   <div className={s.heroCopy}><p className={s.kicker}>晴屿 · QINGYU</p><h1>选一个主角，<br/><span>开始探险。</span></h1><div className={s.heroActions}><button className={s.primary} onClick={()=>p.onStart(featured)}>开始探险 <Icon name="chevron" size={17}/></button><button className={s.subtle} onClick={()=>p.onCharacter(featured)}>认识{featured.name} <Icon name="chevron" size={16}/></button></div><div className={s.backgroundLabel}>选择主角</div><div className={s.heroCharacters} aria-label="选择首页背景角色">{QINGYU_CHARACTERS.map((c,i)=><button key={c.id} aria-label={`选择${c.name}`} aria-pressed={selected===i} onClick={()=>selectCharacter(i)}><span className={s.backgroundAvatar}><img src={c.cover} alt=""/></span><span>{c.name}</span></button>)}</div></div>
   <div className={s.heroIdentity} key={`${featured.id}-line`}><span>0{selected+1} / 04</span><h2>{featured.name}</h2></div>
   <div className={s.heroFootnote}>A MOMENT WITH YOU · 一封写给此刻的心笺</div>
  </section>
  <section className={s.encounters} aria-labelledby="encounters-title"><div className={s.sectionHeading}><div><p className={s.kicker}>STORY RANKING</p><h2 id="encounters-title">故事排名</h2></div><div className={s.directoryTools}><button onClick={p.onImport}><Icon name="upload" size={15}/>导入</button></div></div>
   <div className={s.directoryBar}><div className={s.tabs}>{["全部相遇","我的收藏","最新相遇"].map(label=><button key={label} aria-pressed={tab===label} onClick={()=>setTab(label)}>{label}</button>)}</div><label className={s.search}><Icon name="search" size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="寻找一个名字，或一种心动" aria-label="搜索相遇角色"/></label></div>
   <><div className={s.rankList}>{ranking.map((c,i)=><article key={c.id} className={s.rankRow} style={{animationDelay:`${i*60}ms`}}><span className={s.rankNumber}>{String(i+1).padStart(2,"0")}</span><button className={s.rankPortrait} aria-label={`查看 ${c.name}`} onClick={()=>p.onCharacter(c)}><img src={c.cover} alt={c.name} loading="lazy"/></button><button className={s.rankInfo} onClick={()=>p.onCharacter(c)}><strong>{c.name}<Icon name="chevron" size={15}/></strong><span>{c.tags.slice(0,3).join(" · ")}</span></button><span className={s.rankHeat}>{c.heat || "—"}</span><button className={`${s.rankFavorite} ${p.favorites.includes(c.id)?s.rankFavoriteActive:""}`} aria-label={`${p.favorites.includes(c.id)?"取消收藏":"收藏"} ${c.name}`} aria-pressed={p.favorites.includes(c.id)} onClick={()=>p.onFavorite(c.id)}><Icon name="heart" size={15}/></button><button className={s.rankStart} onClick={()=>p.onStart(c)}>开始探险</button></article>)}</div>{!ranking.length&&<div className={s.empty}><h3>{tab==="我的收藏"?"还没有收藏":"没有找到角色"}</h3><button onClick={()=>{setTab("全部相遇");setSearch("");}}>查看全部 <Icon name="chevron" size={16}/></button></div>}</>
  </section>
  <footer className={s.footer}><span>晴屿 QINGYU <i/> 温柔发生，故事继续。</span><a href="/community-guidelines">全年龄社区约定 <Icon name="chevron" size={13}/></a></footer>
 </div>;
}
