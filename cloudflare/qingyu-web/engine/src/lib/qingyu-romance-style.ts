import style from "../../companion-native/runtime/qingyu-romance-style.json";

export const QINGYU_ROMANCE_STYLE = style;
export const QINGYU_TAVERN_STYLE = [style.tone, style.relationship, style.tavern].join("\n");
export const QINGYU_COMPANION_STYLE = [style.tone, style.relationship, style.companion].join("\n");
