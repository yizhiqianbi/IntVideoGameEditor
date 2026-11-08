"use client";
import { useRef, useState } from "react";
import { DRAMA_PROMPT_LIMIT } from "@/lib/drama";
import type { ReferenceSlot } from "@/lib/drama-mentions";
import styles from "./studio.module.css";

function previewableSlotImage(url: string) {
  return (
    url.startsWith("data:image/") ||
    url.startsWith("blob:") ||
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/")
  );
}

export function MentionField({
  id,
  listId,
  className,
  value,
  disabled,
  placeholder,
  maxLength = DRAMA_PROMPT_LIMIT,
  slots,
  bindings,
  showChips = false,
  compactChips = false,
  emptyHint = "先勾选带图片的参考卡，或上传视频、音频。",
  onChange,
}: {
  id?: string;
  listId: string;
  className?: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  slots: ReferenceSlot[];
  bindings: Record<string, string>;
  showChips?: boolean;
  compactChips?: boolean;
  emptyHint?: string;
  onChange: (value: string, bindings?: Record<string, string>) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{
    start: number;
    end: number;
    text: string;
  } | null>(null);
  const [active, setActive] = useState(0);
  const filtered = slots.filter(
    (slot) =>
      !query?.text ||
      `${slot.name} ${slot.token} ${
        slot.kind === "Image" ? "图片" : slot.kind === "Video" ? "视频" : "音频"
      }`
        .toLowerCase()
        .includes(query.text.toLowerCase()),
  );
  function track(next: string, caret: number) {
    const match = next.slice(0, caret).match(/@([^@\s]{0,40})$/);
    setQuery(
      match
        ? { start: caret - match[0].length, end: caret, text: match[1] }
        : null,
    );
    setActive(0);
  }
  function insert(slot: ReferenceSlot) {
    const start =
      query?.start ?? input.current?.selectionStart ?? value.length;
    const end = query?.end ?? input.current?.selectionEnd ?? start;
    const text = `@${slot.token} `;
    const prompt = value.slice(0, start) + text + value.slice(end);
    if (prompt.length > maxLength) return;
    onChange(prompt, { ...bindings, [slot.token]: slot.source });
    setQuery(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  return (
    <div className={styles.mentionField}>
      <textarea
        ref={input}
        id={id}
        className={className}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-controls={query ? listId : undefined}
        aria-expanded={!!query}
        aria-autocomplete="list"
        aria-activedescendant={
          query && filtered.length
            ? `${listId}-${Math.min(active, filtered.length - 1)}`
            : undefined
        }
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) =>
          track(e.currentTarget.value, e.currentTarget.selectionStart)
        }
        onBlur={() => setQuery(null)}
        onKeyDown={(e) => {
          if (!query) return;
          if (e.key === "Escape") {
            e.preventDefault();
            setQuery(null);
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((n) =>
              Math.max(
                0,
                Math.min(
                  filtered.length - 1,
                  n + (e.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if ((e.key === "Enter" || e.key === "Tab") && filtered.length) {
            e.preventDefault();
            insert(filtered[Math.min(active, filtered.length - 1)]);
          }
        }}
      />
      {query && (
        <div
          id={listId}
          role="listbox"
          aria-label="选择参考素材"
          className={styles.mentionMenu}
        >
          {filtered.length ? (
            filtered.map((slot, i) => (
              <button
                key={slot.source}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(slot)}
              >
                <b>@{slot.token}</b>
                <span>{slot.name}</span>
              </button>
            ))
          ) : (
            <small>
              {slots.length ? "没有匹配素材" : emptyHint}
            </small>
          )}
        </div>
      )}
      {showChips && (
        <div
          className={
            compactChips ? styles.directorSlots : styles.referenceSlots
          }
          aria-label="参考素材槽位"
        >
          {slots.map((slot) => (
            <button
              type="button"
              key={slot.source}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(slot)}
              title={`引用 ${slot.name}`}
            >
              {slot.kind === "Image" && previewableSlotImage(slot.url) ? (
                <img src={slot.url} alt="" />
              ) : (
                <span className={styles.slotIcon}>
                  {slot.kind === "Video" ? "▶" : slot.kind === "Audio" ? "♫" : "▣"}
                </span>
              )}
              <span>
                <b>@{slot.token}</b>
                <small>{slot.name}</small>
              </span>
            </button>
          ))}
          {!slots.length && <small>{emptyHint}</small>}
        </div>
      )}
    </div>
  );
}
