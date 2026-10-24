import {useState} from "react";
import type {Character} from "@/lib/dzmm-characters";
import type {DzmmPreferences} from "@/lib/dzmm-storage";
import type {DzmmAuthor} from "@/lib/dzmm-discovery";
import {QINGYU_CHARACTERS} from "@/lib/qingyu-catalog";
import Icon from "./icons";
import s from "./otome-home.module.css";
type Props={characters:Character[];favorites:string[];likes:string[];preferences:DzmmPreferences;authors:DzmmAuthor[];onCharacter:(c:Character)=>void;onStart:(c:Character)=>void;onFavorite:(id:string)=>void;onLike:(id:string)=>void;onAuthor:(a:DzmmAuthor)=>void;onNavigate:(view:"chat"|"live"|"novels"|"studio"|"voice"|"presets")=>void;onImport:()=>void};
const lines=["未完成的旋律，想和你一起听。","有些故事，值得被认真记得。","下一站，也想听听你的答案。","今夜的星空，留了一个位置给你。"];
export default function OtomeHome(p:Props){
 const [selected,setSelected]=useState(()=>{try{const saved=localStorage.getItem("qingyu-background-character");const index=QINGYU_CHARACTERS.findIndex(c=>c.id===saved);return index<0?0:index;}catch{return 0;}});
 function selectCharacter(index:number){setSelected(index);try{localStorage.setItem("qingyu-background-character",QINGYU_CHARACTERS[index].id);}catch{/* Background changes remain usable without browser storage. */}}const [tab,setTab]=useState("全部相遇");const [search,setSearch]=useState("");
 const featured=QINGYU_CHARACTERS[selected];
 const cards=p.characters.filter(c=>(tab!=="我的收藏"||p.favorites.includes(c.id))&&`${c.name} ${c.description} ${c.tags.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>tab==="最新相遇"?Date.parse(b.createdAt)-Date.parse(a.createdAt):0);
 return <div className={s.home}>
  <section className={s.hero} aria-label="今日心动相遇">
   <div className={s.heroBackdrop} key={featured.id}><img src={featured.cover} alt={`${featured.name}的原创立绘`} fetchPriority="high"/></div>
   <span className={s.orbit} aria-hidden="true"/>
   <div className={s.heroCopy}><p className={s.kicker}>A LITTLE ISLAND, JUST FOR YOU</p><div className={s.brandCaption}>晴屿<span>QINGYU</span></div><h1>今夜的故事，<br/>从<span>与你相遇</span>开始。</h1><p className={s.heroDescription}>把心事说给他听，让故事慢慢发生。</p><div className={s.heroActions}><button className={s.primary} onClick={()=>p.onStart(featured)}>和{featured.name}开始故事 <Icon name="chevron" size={17}/></button><button className={s.subtle} onClick={()=>p.onCharacter(featured)}>走近他 <Icon name="chevron" size={16}/></button></div><div className={s.backgroundLabel}>今夜，想见谁<span>选择首页背景</span></div><div className={s.heroCharacters} aria-label="选择首页背景角色">{QINGYU_CHARACTERS.map((c,i)=><button key={c.id} aria-label={`选择${c.name}`} aria-pressed={selected===i} onClick={()=>selectCharacter(i)}><span className={s.backgroundAvatar}><img src={c.cover} alt=""/></span><span>{c.name}</span></button>)}</div></div>
   <div className={s.heroIdentity} key={`${featured.id}-line`}><span>0{selected+1} / 04</span><h2>{featured.name}</h2><p>{lines[selected]}</p><button onClick={()=>p.onCharacter(featured)}>人物档案 <Icon name="chevron" size={15}/></button></div>
   <div className={s.heroFootnote}>A MOMENT WITH YOU · 一封写给此刻的心笺</div>
  </section>
  <section className={s.shortcuts} aria-label="常用功能">
   <button onClick={()=>p.onNavigate("chat")}><span className={s.shortcutIcon}><Icon name="chat" size={24}/></span><span><strong>心笺</strong><small>接着上次的话，慢慢聊</small></span><Icon name="chevron" size={17}/></button>
   <button onClick={()=>p.onNavigate("novels")}><span className={s.shortcutIcon}><Icon name="book" size={24}/></span><span><strong>故事长卷</strong><small>写下属于你的后续</small></span><Icon name="chevron" size={17}/></button>
   <button onClick={()=>p.onNavigate("studio")}><span className={s.shortcutIcon}><Icon name="edit" size={24}/></span><span><strong>灵感工坊</strong><small>角色、世界与互动创作</small></span><Icon name="chevron" size={17}/></button>
  </section>
  <section className={s.encounters} aria-labelledby="encounters-title"><div className={s.sectionHeading}><div><p className={s.kicker}>THE STORIES WE WILL SHARE</p><h2 id="encounters-title">下一次相遇<span>你心里的故事，在这里有了姓名。</span></h2></div><div className={s.directoryTools}><button onClick={p.onImport}><Icon name="upload" size={15}/>导入角色卡</button></div></div>
   <div className={s.directoryBar}><div className={s.tabs}>{["全部相遇","我的收藏","最新相遇"].map(label=><button key={label} aria-pressed={tab===label} onClick={()=>setTab(label)}>{label}</button>)}</div><label className={s.search}><Icon name="search" size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="寻找一个名字，或一种心动" aria-label="搜索相遇角色"/></label></div>
   <><div className={s.cards}>{cards.map((c,i)=><article key={c.id} className={s.card} style={{animationDelay:`${i*60}ms`}}><div className={s.portrait}><button aria-label={`查看 ${c.name}`} onClick={()=>p.onCharacter(c)}><img src={c.cover} alt={c.name} loading="lazy"/></button><span>{c.tags[0]}</span><button className={s.favorite} aria-label={`${p.favorites.includes(c.id)?"取消收藏":"收藏"} ${c.name}`} aria-pressed={p.favorites.includes(c.id)} onClick={()=>p.onFavorite(c.id)}><Icon name="heart" size={18}/></button></div><button className={s.cardTitle} onClick={()=>p.onCharacter(c)}><h3>{c.name}<Icon name="chevron" size={17}/></h3><p>{c.introduction || c.description}</p></button><div className={s.cardFoot}><span>{c.tags.slice(1,3).join(" · ")}</span><button aria-label={`点赞 ${c.name}`} aria-pressed={p.likes.includes(c.id)} onClick={()=>p.onLike(c.id)}><Icon name="heart" size={13}/>{c.siteLikeCount??0}</button></div></article>)}</div>{!cards.length&&<div className={s.empty}><Icon name="heart" size={30}/><h3>{tab==="我的收藏"?"把喜欢，悄悄收藏在这里。":"还没找到这一次相遇。"}</h3><p>试试别的名字，或从一个新角色开始。</p><button onClick={()=>{setTab("全部相遇");setSearch("");}}>回到全部相遇 <Icon name="chevron" size={16}/></button></div>}</>
  </section>
  <footer className={s.footer}><span>晴屿 QINGYU <i/> 温柔发生，故事继续。</span><a href="/community-guidelines">全年龄社区约定 <Icon name="chevron" size={13}/></a></footer>
 </div>;
}
