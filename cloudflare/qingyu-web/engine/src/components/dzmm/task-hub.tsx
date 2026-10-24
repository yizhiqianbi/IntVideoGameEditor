"use client";

import { useState } from "react";
import type { Character } from "../../lib/dzmm-characters";
import { TaskCenter } from "./task-center";
import { TaskMarket } from "./task-market";
import s from "./task-hub.module.css";

type Props = {
  userId: string;
  isGuest: boolean;
  isSuper: boolean;
  characters: Character[];
  onCharacter: (id: string) => void;
  onNavigate: (view: "chat" | "studio" | "characters" | "profile" | "forum" | "recharge") => void;
  onRequireAccount: () => void;
  beforeRefresh?: () => Promise<void>;
};

export function TaskHub({ userId, isGuest, isSuper, characters, onCharacter, onNavigate, onRequireAccount, beforeRefresh }: Props) {
  // Put the onboarding path first: it is the most useful landing state for a
  // new account, while the player marketplace remains one click away.
  const [tab, setTab] = useState<"market" | "platform">("platform");
  return <>
    <div className={s.switcher} role="tablist" aria-label="任务类型">
      <button type="button" id="task-hub-platform-tab" role="tab" aria-selected={tab === "platform"} aria-controls="task-hub-platform-panel" onClick={() => setTab("platform")}>新手任务</button>
      <button type="button" id="task-hub-market-tab" role="tab" aria-selected={tab === "market"} aria-controls="task-hub-market-panel" onClick={() => setTab("market")}>玩家委托</button>
    </div>
    <div id="task-hub-platform-panel" hidden={tab !== "platform"} role="tabpanel" aria-labelledby="task-hub-platform-tab">
      {tab === "platform" && <TaskCenter key={userId} userId={userId} isGuest={isGuest} onNavigate={onNavigate} onRequireAccount={onRequireAccount} beforeRefresh={beforeRefresh} />}
    </div>
    <div id="task-hub-market-panel" hidden={tab !== "market"} role="tabpanel" aria-labelledby="task-hub-market-tab">
      <TaskMarket key={userId} userId={userId} isGuest={isGuest} isSuper={isSuper} characters={characters} onCharacter={character => onCharacter(character.id)} onRequireAccount={onRequireAccount} />
    </div>
  </>;
}
