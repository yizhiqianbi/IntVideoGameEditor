import type { Metadata } from "next";
import CommunityGuidelines from "@/components/dzmm/community-guidelines";
import { XUMENG_COMMUNITY_GUIDELINES_TITLE, XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION } from "@/lib/xumeng-community-guidelines";

export const metadata: Metadata = { title: XUMENG_COMMUNITY_GUIDELINES_TITLE, description: XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION };

export default function CommunityGuidelinesPage() { return <CommunityGuidelines />; }
