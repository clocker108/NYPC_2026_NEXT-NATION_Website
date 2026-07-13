import type { Metadata } from "next";
import localFont from "next/font/local";
import "../src/styles/globals.css";

// 셀프호스팅 폰트 — 시스템 폰트 유무와 무관하게 동일한 타이포 보장 (src/fonts/README.md)
const pretendard = localFont({
  src: "../src/fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

// 제목(NEXT NATION) 전용 디스플레이 폰트
const audiowide = localFont({
  src: "../src/fonts/audiowide-latin-400-normal.woff2",
  display: "swap",
  weight: "400",
  variable: "--font-audiowide",
});

export const metadata: Metadata = {
  title: "NEXT NATION",
  description: "NEXT NATION 웹 — 로컬 대전·인공지능 대전·인터넷 대전·데모 대결",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${pretendard.variable} ${audiowide.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
