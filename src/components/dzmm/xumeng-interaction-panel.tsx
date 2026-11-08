"use client";

import { useState } from "react";
import type { XumengInteractionTemplate, XumengPanelValues } from "../../lib/xumeng-interaction-panels";
import styles from "./xumeng-interaction-panel.module.css";

type PanelProps = { template: XumengInteractionTemplate; values: XumengPanelValues; className?: string };

export function XumengPanelGrid({ template, values }: Omit<PanelProps, "className">) {
  return <>{template.panels.map(panel => <section key={panel.id} className={styles.section} aria-label={panel.title}>
    <h4>{panel.title}</h4>
    <dl>{panel.fields.map(field => {
      const value = values[panel.title]?.[field.name] ?? field.initial;
      if (field.type === "meter") {
        const number = Math.min(100, Math.max(0, Number(value) || 0));
        return <div key={field.name} className={styles.meterRow}><dt>{field.name}</dt><dd><span className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={number} aria-label={field.name}><span style={{ width: `${number}%` }} /></span><b>{number}/100</b></dd></div>;
      }
      if (field.type === "list") {
        const items = value.split(/[、,，]/).map(item => item.trim()).filter(Boolean);
        return <div key={field.name}><dt>{field.name}</dt><dd>{items.length ? <span className={styles.items}>{items.map(item => <span key={item}>{item}</span>)}</span> : "空"}</dd></div>;
      }
      return <div key={field.name}><dt>{field.name}</dt><dd>{value || "未知"}</dd></div>;
    })}</dl>
  </section>)}</>;
}

/** Collapsible bar above the chat; collapsed it shows the first two text values. */
export default function XumengInteractionPanel({ template, values, className }: PanelProps) {
  const [open, setOpen] = useState(false);
  if (!template.panels.length) return null;
  const preview = template.panels.flatMap(panel => panel.fields.filter(field => field.type !== "list").map(field => {
    const value = values[panel.title]?.[field.name] ?? field.initial;
    return field.type === "meter" ? `${field.name} ${value}` : value;
  })).filter(value => value && value !== "未知").slice(0, 3).join(" · ");
  return <div className={`${styles.panel} ${className ?? ""}`}>
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <strong>{template.panels.map(panel => panel.title).join(" / ")}</strong>
      <span>{preview || "展开查看"}</span>
      <i aria-hidden>{open ? "收起" : "展开"}</i>
    </button>
    {open && <div className={styles.body}><XumengPanelGrid template={template} values={values} /></div>}
  </div>;
}

