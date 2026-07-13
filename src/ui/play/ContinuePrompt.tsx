"use client";

// 관전(review) 단계 안내 — 상단 바 바로 아래 작은 문구. 클릭은 맵이 받아서
// (gameStore.clickCell의 review 분기) 다음으로 진행하므로 이 표시는 클릭을 막지 않는다.

export default function ContinuePrompt() {
  return (
    // top-4 = 맵 좌하단 줌 플로팅바(bottom-4 left-4)와 같은 16px 마진
    <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
      <span className="animate-pulse rounded-full border border-chromeline bg-chrome2/85 px-4 py-2.5 text-[13px] text-chromedim">
        계속 진행하시려면 맵을 클릭하세요 ▶
      </span>
    </div>
  );
}
