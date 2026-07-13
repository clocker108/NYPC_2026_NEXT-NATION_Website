"use client";

// 업데이트 내용 안내 창 — 우하단 "업데이트 내용" 클릭 시 뜨는 단일-버튼 메시지 창.
// ConfirmDialog의 오버레이/퇴장 패턴을 그대로 따르되(바깥클릭·Esc·animejs 페이드아웃),
// 파괴적 동작이 아니므로 버튼은 "확인" 하나뿐. 내역은 changelog 단일 소스에서 읽는다.

import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { CHANGELOG } from "@/changelog";

export default function UpdatesDialog({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  // 퇴장 애니메이션 후 콜백 — 중복 클릭/onComplete 유실 모두 방지 (ConfirmDialog와 동일).
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const root = rootRef.current;
    if (!root) {
      onClose();
      return;
    }
    let called = false;
    const fire = () => {
      if (called) return;
      called = true;
      onClose();
    };
    animate(root, { opacity: 0, duration: 180, ease: "outQuad", onComplete: fire });
    if (cardRef.current) {
      animate(cardRef.current, { translateY: -8, scale: 0.97, duration: 180, ease: "outQuad" });
    }
    setTimeout(fire, 280); // 보증 — 트윈이 대체돼도 콜백은 반드시 실행
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        ref={cardRef}
        className="dropdown-enter flex max-h-[80vh] w-[420px] max-w-[90vw] flex-col rounded-2xl border border-chromeline bg-chrome p-6 shadow-2xl"
        role="dialog"
        aria-modal
        aria-label="업데이트 내용"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl">📢</span>
          <h2 className="font-title text-lg text-white">업데이트 내용</h2>
        </div>

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>
              <span className="inline-block rounded-md border border-chromeline/50 bg-chrome2 px-2 py-0.5 text-xs font-bold text-ngold">
                {entry.version}
              </span>
              <ul className="mt-2 flex flex-col gap-1.5">
                {entry.notes.map((note, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-white/90">
                    <span className="select-none text-chromedim">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button
          className="mt-5 cursor-pointer rounded-lg border border-chromeline/50 bg-chrome2 py-2.5 font-bold text-chromedim transition hover:text-white"
          onClick={close}
        >
          확인
        </button>
      </div>
    </div>
  );
}
