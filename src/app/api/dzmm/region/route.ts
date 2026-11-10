import { NextResponse } from "next/server";
import { xumengLocaleFromCountry } from "@/lib/xumeng-region";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const country = request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry");
  return NextResponse.json({ country: country?.toUpperCase() ?? null, locale: xumengLocaleFromCountry(country) ?? "zh-Hans" }, {
    headers: { "Cache-Control": "no-store", Vary: "x-vercel-ip-country, cf-ipcountry" },
  });
}
