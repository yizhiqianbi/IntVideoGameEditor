import { redirect } from "next/navigation";

export default async function LeadDetailRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/film/${slug}`);
}
