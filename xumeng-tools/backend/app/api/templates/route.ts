import { publicGallery } from "@/lib/live-edits";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const gallery = publicGallery();
  return NextResponse.json({
    groups: gallery.groups,
    images: gallery.images.map(item => ({
      id: item.id,
      label: item.label,
      englishLabel: item.englishLabel,
      group: item.group,
      aspectRatio: item.aspectRatio,
      frame: item.frame,
      cover: item.cover,
    })),
    videos: gallery.videos.map(item => ({
      id: item.id,
      label: item.label,
      englishLabel: item.englishLabel,
      description: item.description,
      action: item.action,
      cover: item.cover,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
