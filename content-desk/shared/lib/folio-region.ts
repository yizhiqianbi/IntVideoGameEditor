import type { FolioLocale } from "./folio-i18n";

export function folioLocaleFromCountry(country: unknown): FolioLocale | null {
  if (typeof country !== "string") return null;
  const code = country.trim().toUpperCase();
  if (code === "CN" || code === "SG" || code === "MY") return "zh-Hans";
  if (code === "TW" || code === "HK" || code === "MO") return "zh-Hant";
  if (code === "JP") return "ja";
  if (code === "KR") return "ko";
  if (code) return "en";
  return null;
}
