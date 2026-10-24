import { renderXumengCommunityGuidelines, XUMENG_COMMUNITY_GUIDELINES_PATH } from "../../lib/xumeng-community-guidelines";
import "./community-guidelines.css";

export default function CommunityGuidelines() {
  return <div dangerouslySetInnerHTML={{ __html: renderXumengCommunityGuidelines() }} />;
}

/** A separate tab preserves in-progress writing and the current modal. */
export function CommunityGuidelinesLink() {
  return <a className="community-guidelines-link" href={XUMENG_COMMUNITY_GUIDELINES_PATH} target="_blank" rel="noopener noreferrer" title="社区公约（新标签页打开）">社区公约<span aria-hidden="true"> ↗</span></a>;
}
