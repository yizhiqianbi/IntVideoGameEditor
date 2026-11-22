"use client";

import { useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import type { DzmmChatMember } from "@/lib/dzmm-storage";
import { CoverVisual } from "./cover-visual";
import { xumengCardCoverUrl } from "@/lib/xumeng-routes";
import Icon from "./icons";
import s from "./group-chat-dialog.module.css";

const EXTRA_MEMBERS = 3;

type Props = {
  primary: Character;
  candidates: readonly Character[];
  onClose: () => void;
  onConfirm: (members: DzmmChatMember[]) => void;
};

/** Minimal group-chat member picker: the opened character plus up to three others. */
export default function GroupChatDialog({ primary, candidates, onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const pool = candidates.filter(character => character.id !== primary.id && !character.listPreview)
    .filter((character, index, list) => list.findIndex(item => item.id === character.id) === index)
    .slice(0, 24);

  const toggle = (id: string) => {
    setError("");
    setSelected(previous => previous.includes(id)
      ? previous.filter(item => item !== id)
      : previous.length >= EXTRA_MEMBERS ? (setError(`群聊最多 ${EXTRA_MEMBERS + 1} 人，先取消一个再添加。`), previous) : [...previous, id]);
  };

  const confirm = () => {
    if (selected.length < 1) { setError("至少再选一个角色，才能开群聊。"); return; }
    const chosen = pool.filter(character => selected.includes(character.id));
    if (chosen.length < 1) { setError("所选角色暂时无法加入群聊。"); return; }
    onConfirm([{ characterId: primary.id, name: primary.name }, ...chosen.map(character => ({ characterId: character.id, name: character.name }))]);
  };

  return <div className={s.overlay} role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="group-chat-title">
      <header>
        <div>
          <h2 id="group-chat-title">一起聊</h2>
          <p>{primary.name} + 最多 {EXTRA_MEMBERS} 位角色，开一个多角色群聊。</p>
        </div>
        <button type="button" className={s.close} onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button>
      </header>
      <ul className={s.list}>
        <li className={s.fixed}><CoverVisual src={xumengCardCoverUrl(primary.cover)} alt="" className={s.avatar} /><span><strong>{primary.name}</strong><small>主角色</small></span><Icon name="check" size={16} /></li>
        {pool.map(character => {
          const checked = selected.includes(character.id);
          return <li key={character.id}>
            <button type="button" className={checked ? `${s.member} ${s.selected}` : s.member} aria-pressed={checked} onClick={() => toggle(character.id)}>
              <CoverVisual src={xumengCardCoverUrl(character.cover)} alt="" className={s.avatar} />
              <span><strong>{character.name}</strong><small>{character.description.replace(/\s+/g, " ").slice(0, 46) || "公开角色"}</small></span>
              <i aria-hidden="true">{checked ? <Icon name="check" size={16} /> : null}</i>
            </button>
          </li>;
        })}
      </ul>
      {pool.length === 0 && <p className={s.empty}>还没有可以一起聊的角色，先去角色广场看看。</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      <footer>
        <span className={s.count}>已选 {selected.length + 1} / {EXTRA_MEMBERS + 1} 人</span>
        <div>
          <button type="button" className={s.secondary} onClick={onClose}>取消</button>
          <button type="button" className={s.primary} disabled={selected.length < 1} onClick={confirm}>开群聊</button>
        </div>
      </footer>
    </div>
  </div>;
}
