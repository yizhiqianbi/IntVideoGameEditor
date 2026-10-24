"use client";

import { useEffect, useRef, useState } from "react";
import type { DzmmSavedConversation } from "@/lib/dzmm-storage";
import Icon from "./icons";
import s from "./tavern.module.css";

type Props = {
  conversation: DzmmSavedConversation;
  nickname: string;
  onBack: () => void;
  onExport: () => void;
  onDelete: () => void;
  onCopy: (text: string) => void;
};

/** Historical text remains accessible without inventing a playable role card. */
export default function UnavailableConversation({ conversation, nickname, onBack, onExport, onDelete, onCopy }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmDelete) confirmButton.current?.focus(); }, [confirmDelete]);
  return <>
    <header className={s.chatHeader}>
      <button type="button" className={`${s.iconButton} ${s.mobileBack}`} aria-label="返回会话列表" onClick={onBack}><Icon name="back" /></button>
      <div className={s.unavailableIdentity}><strong>{conversation.title}</strong><small>只读历史</small></div>
      <div className={s.chatHeaderTools}>
        <button type="button" className={s.iconButton} aria-label="导出只读会话" title="导出会话存档" onClick={onExport}><Icon name="download" size={17} /></button>
        <button type="button" className={s.iconButton} aria-label="删除只读会话" title="删除会话" onClick={() => setConfirmDelete(true)}>删除</button>
      </div>
    </header>
    <section className={s.unavailableNotice} aria-label="角色不可用的历史说明">
      <p>关联角色当前不可用，聊天原文仍保留。你可以查看、复制、导出或删除这段会话；角色恢复后可以继续对话。</p>
      {confirmDelete && <div role="group" aria-label="确认删除只读会话" onKeyDown={event => { if (event.key === "Escape") setConfirmDelete(false); }}>
        <p>确认删除「{conversation.title}」及全部 {conversation.messages.length} 条消息？需要保留时，请先导出会话存档。</p>
        <button type="button" className={s.textButton} onClick={() => setConfirmDelete(false)}>取消</button>
        <button ref={confirmButton} type="button" className={s.textButton} onClick={onDelete}>确认删除</button>
      </div>}
    </section>
    <div className={s.messageScroll}>
      <div className={s.messageList}>
        {conversation.messages.map((message, index) => <div key={message.id} className={`${s.messageRow} ${message.role === "user" ? s.userRow : ""}`}>
          <div className={s.messageContent} role="group" aria-label={`第 ${index + 1} 条历史消息`}>
            <span className={s.messageName}>{message.role === "user" ? nickname : "保存的回复"}</span>
            <div className={s.messageBubble} data-message-text>{message.content}</div>
            <div className={s.messageActions}><button type="button" className={s.regenerate} aria-label={`复制第 ${index + 1} 条历史消息`} onClick={() => onCopy(message.content)}><Icon name="copy" size={13} />复制</button></div>
          </div>
        </div>)}
        {!conversation.messages.length && <p className={s.sidebarEmpty}>这段会话还没有消息。</p>}
      </div>
    </div>
  </>;
}
