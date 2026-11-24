import "./styles.css";

export const metadata = {
  title: "尾语 PAWTALE · 和有尾巴的朋友，说说日常",
  description: "在尾语小镇，与猫猫狗狗居民相遇，一起聊天、写故事、收藏平凡日子里的小小快乐。全年龄原创角色陪伴。",
  robots: { index: false, follow: false },
  icons: { icon: "/mark.svg" },
};

export default function RootLayout({ children }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
