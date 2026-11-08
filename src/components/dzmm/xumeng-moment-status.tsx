"use client";

import { useState, type ReactNode } from "react";
import { cleanStatusText, readStatusChips, readStatusMeter, type StatusMeterReading, type StatusTrend } from "../../lib/xumeng-status-display";
import Icon from "./icons";
import styles from "./xumeng-moment-status.module.css";

export type MomentField = { key: string; label: string; type: "text" | "meter" | "list"; value: string };
export type MomentSection = { title: string; fields: MomentField[]; notes?: string[] };

type CardProps = {
  name: string;
  sections: MomentSection[];
  children?: ReactNode;
};

type MomentProps = {
  name: string;
  fields: MomentField[];
  sections?: MomentSection[];
  imageLabel: string;
  imageHint: string;
  disabled: boolean;
  onImage: () => void;
  slot?: ReactNode;
};

function shown(value: string): string {
  return cleanStatusText(value) || "—";
}

function preview(fields: MomentField[]): string {
  return fields.slice(0, 3).map(field => {
    const meter = readStatusMeter(field.value, field);
    if (meter) return `${field.label} ${meter.caption}`;
    const text = shown(field.value);
    return text === "—" ? "" : text;
  }).filter(Boolean).join(" · ");
}

function tone(label: string): string {
  if (/事件|剧情|秘密|经过/u.test(label)) return "event";
  if (/时间|时刻|钟点/u.test(label)) return "time";
  if (/眼神|表情|目光/u.test(label)) return "eye";
  if (/语气|声音|口吻|对白/u.test(label)) return "voice";
  if (/想法|内心|独白|心理|心声/u.test(label)) return "thought";
  if (/衣|装|服|袜|裙/u.test(label)) return "cloth";
  if (/地点|场景|位置|场所|房间/u.test(label)) return "place";
  if (/理智|防线|精神|意志/u.test(label)) return "shield";
  if (/好感|爱|情|心动/u.test(label)) return "heart";
  if (/欲|生理/u.test(label)) return "drive";
  if (/崩溃|恐惧|社死|惊慌|情绪|心情|状态/u.test(label)) return "mood";
  if (/关系|阶段/u.test(label)) return "bond";
  return "plain";
}

function sectionKind(title: string): string {
  if (/关系|阶段/u.test(title)) return "bond";
  if (/时间/u.test(title)) return "time";
  if (/场景|地点|世界/u.test(title)) return "place";
  return "person";
}

function Glyph({ label, kind = tone(label) }: { label: string; kind?: string }) {
  return <svg className={styles.glyph} data-kind={kind} viewBox="0 0 16 16" aria-hidden="true">
    {kind === "heart" && <path d="M8 13.2 3.7 8.9a2.5 2.5 0 0 1 3.6-3.5L8 6.1l.7-.7a2.5 2.5 0 0 1 3.6 3.5Z" />}
    {kind === "drive" && <path d="M8.6 1.8 4.2 8.2h3.1L6.8 14.2 12 6.6H8.8Z" />}
    {kind === "mood" && <><circle cx="8" cy="8" r="5.2" /><path d="M5.6 9.4c.7.9 1.5 1.3 2.4 1.3s1.7-.4 2.4-1.3" /><path d="M6 6.6h.01M10 6.6h.01" /></>}
    {kind === "thought" && <path d="M4.2 11.2a2.3 2.3 0 0 1-.4-4.1A3.1 3.1 0 0 1 8 4.2a2.7 2.7 0 0 1 4.2 2.6 2.2 2.2 0 0 1-.2 4.4H5.2" />}
    {kind === "cloth" && <path d="M5.4 3.2 8 5.4 10.6 3.2 13 6 10.8 7.2V13H5.2V7.2L3 6Z" />}
    {kind === "place" && <><path d="M8 14.2s4.6-4.5 4.6-7.4a4.6 4.6 0 1 0-9.2 0c0 2.9 4.6 7.4 4.6 7.4Z" /><circle cx="8" cy="6.7" r="1.5" /></>}
    {kind === "bond" && <path d="M8 2.4 9.5 6h3.6L10.5 8.2l1.2 3.8L8 9.8 4.3 12l1.2-3.8L2.9 6h3.6Z" />}
    {kind === "voice" && <><path d="M3 6.4h2.2L8 3.8v8.4L5.2 9.6H3Z" /><path d="M10.2 6.1a3 3 0 0 1 0 3.8M11.8 4.5a5 5 0 0 1 0 7" /></>}
    {kind === "event" && <><rect x="4" y="2.4" width="8" height="11.2" rx="1.4" /><path d="M6.2 6.2h3.6M6.2 8.6h3.6M6.2 11h2.2" /></>}
    {kind === "time" && <><circle cx="8" cy="8" r="5.2" /><path d="M8 5.2V8l2.1 1.4" /></>}
    {kind === "eye" && <><path d="M2.2 8S4.6 4.4 8 4.4 13.8 8 13.8 8 11.4 11.6 8 11.6 2.2 8 2.2 8Z" /><circle cx="8" cy="8" r="1.5" /></>}
    {kind === "shield" && <path d="M8 2.2 13 4.2v4c0 3.1-2.1 5-5 6.4-2.9-1.4-5-3.3-5-6.4v-4Z" />}
    {kind === "person" && <><circle cx="8" cy="5.2" r="2.2" /><path d="M3.6 13.2c.7-2.4 2.3-3.5 4.4-3.5s3.7 1.1 4.4 3.5" /></>}
    {kind === "plain" && <circle cx="8" cy="8" r="2.1" />}
  </svg>;
}

function Trend({ trend }: { trend: StatusTrend }) {
  return <svg className={styles.trend} data-trend={trend} viewBox="0 0 10 10" aria-hidden="true">
    {trend === "up" ? <path d="M2 7.2 5 3.2 8 7.2" /> : <path d="M2 3.2 5 7.2 8 3.2" />}
  </svg>;
}

function Meter({ reading, label }: { reading: StatusMeterReading; label: string }) {
  const scaled = reading.caption.endsWith("%");
  return <>
    {scaled && <span className={styles.track} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={reading.percent} aria-label={label}>
      <span style={{ width: `${reading.percent}%` }} />
    </span>}
    <b>{reading.caption}</b>
    {reading.trend && <Trend trend={reading.trend} />}
    {reading.note && <span className={styles.note}>（{reading.note}）</span>}
  </>;
}

function StatusRow({ field }: { field: MomentField }) {
  const text = shown(field.value);
  const meter = readStatusMeter(field.value, field);
  const chips = meter ? null : readStatusChips(field.value, field);
  return <div className={styles.row}>
    <Glyph label={field.label} />
    <span className={styles.label}>{field.label}</span>
    <span className={styles.dot} aria-hidden="true">·</span>
    <p className={styles.copy}>
      {meter && <Meter reading={meter} label={field.label} />}
      {!meter && chips && <span className={styles.chips}>{chips.map((item, index) => <i key={`${item}:${index}`}>{item}</i>)}</span>}
      {!meter && !chips && <span className={styles.value}>{text}</span>}
    </p>
  </div>;
}

function resolvedSections(name: string, fields: MomentField[], sections?: MomentSection[]): MomentSection[] {
  const source = sections?.length ? sections : [{ title: "", fields }];
  const titled = source.some(section => section.title.trim());
  if (!titled) return [{ title: name, fields: source.flatMap(section => section.fields), notes: source.flatMap(section => section.notes ?? []) }];
  return source.map((section, index) => ({
    title: section.title.trim() || (index === 0 ? name : "状态"),
    fields: section.fields,
    notes: section.notes,
  }));
}

export function XumengStatusCard({ name, sections, children }: CardProps) {
  const visible = sections.filter(section => section.fields.length || section.notes?.length);
  const sample = visible.flatMap(section => section.fields);
  const [opened, setOpened] = useState(visible.length > 0);
  return <section className={styles.card} aria-label={sample.length ? `${name}的此刻状态` : "解锁此刻画面"}>
    <details open={opened} onToggle={event => setOpened(event.currentTarget.open)}>
      <summary>
        <strong>{name}</strong>
        <span className={styles.preview}>{preview(sample) || "展开状态"}</span>
        <i className={styles.badge}><Icon name="heart" size={12} />状态</i>
      </summary>
      {visible.length > 0 && <div className={styles.body}>
      {visible.map((section, index) => {
        const title = section.title.trim() || (index === 0 ? name : "");
        return <section key={`${title}:${index}`} className={styles.section}>
        {title && <h3 className={styles.sectionTitle}><Glyph label={title} kind={sectionKind(title)} /><span>{title}</span></h3>}
          {section.fields.map(field => <StatusRow key={field.key} field={field} />)}
        {section.notes?.map((note, noteIndex) => <p key={`${note}:${noteIndex}`} className={styles.aside}>{shown(note)}</p>)}
      </section>;
      })}
      </div>}
    </details>
    {children}
  </section>;
}

function imageAction(imageLabel: string, imageHint: string, disabled: boolean, onImage: () => void, slot?: ReactNode) {
  return <>
    {slot && <div className={styles.slot}>{slot}</div>}
    {!slot && <button type="button" className={styles.unlock} disabled={disabled} onClick={onImage}>
      <Icon name="image" size={15} />
      <span><strong>{imageLabel}</strong><small>{imageHint}</small></span>
    </button>}
  </>;
}

export default function XumengMomentStatusCard({ name, fields, sections, imageLabel, imageHint, disabled, onImage, slot }: MomentProps) {
  const resolved = resolvedSections(name, fields, sections);
  const hasStatus = resolved.some(section => section.fields.length || section.notes?.length);
  const action = imageAction(imageLabel, imageHint, disabled, onImage, slot);
  if (!hasStatus) return <section className={styles.card} aria-label="解锁此刻画面">{action}</section>;
  return <XumengStatusCard name={name} sections={resolved}>{action}</XumengStatusCard>;
}
