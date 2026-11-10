import type { XumengLocale } from "./xumeng-i18n";

export function xumengLocaleFromCountry(country: unknown): XumengLocale | null {
  if (typeof country !== "string") return null;
  const code = country.trim().toUpperCase();
  if (code === "CN" || code === "SG" || code === "MY") return "zh-Hans";
  if (code === "TW" || code === "HK" || code === "MO") return "zh-Hant";
  if (code === "JP") return "ja";
  if (code === "KR") return "ko";
  if (code) return "en";
  return null;
}
