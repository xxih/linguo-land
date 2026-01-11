import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinguoLand Admin",
  description: "后台管理系统 - 管理词族数据",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

