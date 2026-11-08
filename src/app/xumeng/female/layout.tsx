import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "叙梦 · Her Stories",
  description: "女性向轻关系角色体验。选择一个今晚想靠近的人。",
  robots: { index: false, follow: false },
};

export default function FemaleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
