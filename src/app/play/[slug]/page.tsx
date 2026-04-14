import { DetailPage } from "@/components/public/detail-page";

export default async function PlayDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DetailPage type="play" slug={slug} />;
}
