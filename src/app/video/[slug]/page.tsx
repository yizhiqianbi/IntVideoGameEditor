import { DetailPage } from "@/components/public/detail-page";

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DetailPage type="video" slug={slug} />;
}
