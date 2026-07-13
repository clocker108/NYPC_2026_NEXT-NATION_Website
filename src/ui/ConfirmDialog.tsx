"use client";

// 공용 확인 다이얼로그 — 네이티브 confirm() 대신 게임 팔레트로 렌더.
// 바깥 클릭/Esc = 취소, 확인 버튼은 파괴적 동작이라 빨강 강조.
// 등장은 CSS(dropdown-enter), 퇴장은 animejs 페이드아웃 후 콜백 실행.

import { useEffect, useRef } from "react";
import { animate } from "animejs";

export default function ConfirmDialog({
  icon = "⚠️",
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  confirmClass = "bg-nred hover:bg-nreddark", // 기본 = 파괴적 동작(빨강)
  onConfirm,
  onCancel,
}: {
  icon?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  // 퇴장 애니메이션 후 콜백 — 중복 클릭/onComplete 유실 모두 방지
  const close = (cb: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    const root = rootRef.current;
    if (!root) {
      cb();
      return;
    }
    let called = false;
    const fire = () => {
      if (called) return;
      called = true;
      cb();
    };
    animate(root, { opacity: 0, duration: 180, ease: "outQuad", onComplete: fire });
    if (cardRef.current) {
      animate(cardRef.current, { translateY: -8, scale: 0.97, duration: 180, ease: "outQuad" });
    }
    setTimeout(fire, 280); // 보증 — 트윈이 다른 애니메이션에 대체돼도 콜백은 반드시 실행
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(onCancel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel]);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 backdrop-blur-[2px]"
      onClick={() => close(onCancel)}
    >
      <div
        ref={cardRef}
        className="dropdown-enter w-[400px] max-w-[90vw] rounded-2xl border border-chromeline bg-chrome p-6 shadow-2xl"
        role="alertdialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-3">
          <span className="text-4xl">{icon}</span>
          <p className="text-center text-base leading-relaxed">{message}</p>
        </div>
        <div className="mt-3 flex gap-3">
          <button
            className="flex-1 cursor-pointer rounded-lg border border-chromeline/50 bg-chrome2 py-2.5 text-chromedim transition hover:text-white"
            onClick={() => close(onCancel)}
          >
            {cancelLabel}
          </button>
          <button
            className={`flex-1 cursor-pointer rounded-lg py-2.5 font-bold transition ${confirmClass}`}
            onClick={() => close(onConfirm)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
