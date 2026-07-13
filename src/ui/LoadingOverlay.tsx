"use client";

// 공용 로딩 오버레이 — 배경이 살짝 비치는 반투명 커튼 + 레이어드 도형 애니메이션
// (ShapesLoader). open=false가 되면 페이드아웃 후 언마운트한다.

import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import ShapesLoader from "./ShapesLoader";

export default function LoadingOverlay({
  open,
  message = "로딩 중…",
  onCancel,
}: {
  open: boolean;
  message?: string;
  onCancel?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  // 최신 open 값 — 초고속 open→close(같은 커밋에 마운트·언마운트 효과가 몰리는 경우) 감지용
  const openRef = useRef(open);
  openRef.current = open;

  // open 변화 처리 — 열릴 땐 즉시 마운트(페이드인은 아래 효과), 닫힐 땐 페이드아웃 후 언마운트
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const root = rootRef.current;
    if (!root) {
      setMounted(false);
      return;
    }
    const a = animate(root, {
      opacity: 0,
      duration: 340,
      ease: "outQuad",
      onComplete: () => setMounted(false),
    });
    // ⚠ 보증 언마운트: open이 한 커밋 안에서 true→false로 뒤집히면 이 페이드아웃의
    // opacity 트윈이 뒤이어 시작되는 페이드인에 대체돼 onComplete가 영영 안 불릴 수 있다
    // (오버레이가 투명하지 않은 채 잔존하며 클릭을 전부 삼키는 버그의 원인).
    const failsafe = setTimeout(() => setMounted(false), 500);
    return () => {
      clearTimeout(failsafe);
      a.cancel();
    };
  }, [open]);

  // 마운트 동안: 페이드인 (도형 애니메이션은 ShapesLoader가 자체 관리)
  useEffect(() => {
    if (!mounted) return;
    // 마운트가 반영되기 전에 이미 닫혔다면(순간 완료된 작업) 아예 그리지 않는다
    if (!openRef.current) {
      setMounted(false);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const a = animate(root, { opacity: [0, 1], duration: 240, ease: "outQuad" });
    return () => {
      a.cancel();
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 opacity-0 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-4">
        <ShapesLoader className="h-64 w-64" />
        <p className="animate-pulse text-sm tracking-wide text-white/85">{message}</p>
        {onCancel && (
          <button
            className="mt-2 cursor-pointer rounded-lg border border-chromeline bg-chrome2/80 px-4 py-1.5 text-sm text-chromedim transition hover:text-white"
            onClick={onCancel}
          >
            취소
          </button>
        )}
      </div>
    </div>
  );
}
