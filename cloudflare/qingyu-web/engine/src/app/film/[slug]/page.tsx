import { DetailPage } from "@/components/public/detail-page";

export default async function FilmDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <DetailPage type="film" slug={slug} />;
}
