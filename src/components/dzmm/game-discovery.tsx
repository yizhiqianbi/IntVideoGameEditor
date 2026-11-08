"use client";
import { useState } from "react";
import type { XumengGameSummary } from "@/lib/xumeng-games";
import type { GamePlaySelection } from "./use-game-play-library";
import Icon from "./icons";
import s from "./game-discovery.module.css";

export default function GameDiscovery({ games, loading, error, isGuest, onPlay, onRefresh, onRequireAccount, onCreate }: {
  games: XumengGameSummary[]; loading: boolean; error: string; isGuest: boolean;
  onPlay: (selection: GamePlaySelection) => void; onRefresh: () => void; onRequireAccount: () => void; onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const mine = games.filter(game => `${game.title} ${game.synopsis}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <main className={s.library}>
    <header className={s.header}>
      <div><h1>游戏</h1><p>打开你的作品，在消息页开始游玩。</p></div>
      <button className={s.create} onClick={onCreate}><Icon name="plus" size={17}/>导入或创作游戏</button>
    </header>
    <section className={s.mine} aria-label="我的私人游戏">
      <div className={s.toolbar}><h2>我的游戏</h2><label className={s.search}><Icon name="search" size={17}/><input aria-label="搜索游戏" placeholder="搜索游戏" maxLength={120} value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
      {isGuest ? <div className={s.empty}><Icon name="game" size={34}/><p>登录后查看自己的游戏作品。</p><button onClick={onRequireAccount}>登录</button></div>
        : loading ? <p role="status" className={s.loading}>正在加载游戏…</p>
        : error ? <div role="alert" className={s.error}>{error}<button onClick={onRefresh}>重试</button></div>
        : mine.length ? <div className={s.privateList}>{mine.map(game=><button key={game.id} aria-label={`游玩${game.title}`} onClick={()=>onPlay({kind:"private",id:game.id})}>
          <span className={s.gameIcon} aria-hidden="true"><Icon name="game" size={24}/></span><span className={s.description}><strong>{game.title}</strong><small>{game.synopsis || "私人游戏作品"}</small></span><Icon name="chevron" size={18}/>
        </button>)}</div>
        : <div className={s.empty}><Icon name="game" size={34}/><p>{games.length ? "没有找到匹配的游戏。" : "还没有游戏作品。先在创作中心导入 HTML 或 ZIP 游戏，保存后即可在这里打开。"}</p>{!games.length && <button onClick={onCreate}>导入游戏</button>}</div>}
    </section>
  </main>;
}
