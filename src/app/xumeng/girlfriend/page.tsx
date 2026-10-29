import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Yume · 叙梦",
  description: "和她聊聊今天，慢慢认识彼此。",
  robots: { index: false, follow: false },
};

export default function GirlfriendPage() { redirect("/xumeng#chat/girlfriend"); }
