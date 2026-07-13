"use client";

// 레이어드 도형 애니메이션 — anime.js 공식 "layered animations" 데모
// (https://codepen.io/juliangarnier/pen/YPzBXXp, MIT)를 로컬 animejs로 포팅.
// LoadingOverlay와 인터넷 대전 대기 화면이 공유하는 순수 표시용 컴포넌트.

import { useEffect, useRef } from "react";
import { createTimeline, spring, utils } from "animejs";

const EASES = ["inOutQuad", "inOutCirc", "inOutSine", spring()];

// 100개의 무작위 키프레임 — 각 구간마다 목표값·이징·길이를 새로 뽑는다 (원본 데모 방식)
function createKeyframes(value: () => number | string) {
  const keyframes = [];
  for (let i = 0; i < 100; i++) {
    keyframes.push({
      to: value,
      ease: utils.randomPick(EASES),
      duration: utils.random(300, 1600),
    });
  }
  return keyframes;
}

export default function ShapesLoader({ className = "h-64 w-64" }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // 도형 애니메이션 (완료되면 스스로 재시작하는 원본 구조)
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let alive = true;
    const anims: { cancel: () => void }[] = [];

    const animateShape = (el: SVGSVGElement) => {
      if (!alive) return;
      const circleEl = el.querySelector("circle");
      const rectEl = el.querySelector("rect");
      const polyEl = el.querySelector("polygon");
      const tl = createTimeline({ onComplete: () => animateShape(el) }).add(
        el,
        {
          translateX: createKeyframes(() => utils.random(-3, 3) + "rem"),
          translateY: createKeyframes(() => utils.random(-3, 3) + "rem"),
          rotate: createKeyframes(() => utils.random(-180, 180)),
        },
        0,
      );
      if (circleEl) {
        tl.add(circleEl, { r: createKeyframes(() => utils.random(24, 56)) }, 0);
      }
      if (rectEl) {
        tl.add(
          rectEl,
          {
            width: createKeyframes(() => utils.random(56, 96)),
            height: createKeyframes(() => utils.random(56, 96)),
          },
          0,
        );
      }
      if (polyEl) {
        const points = (polyEl.getAttribute("points") ?? "").split(" ").map((v) => +v);
        tl.add(
          polyEl,
          {
            points: createKeyframes(() => {
              const s = utils.random(0.9, 1.6, 3);
              return `${points[0] * s} ${points[1] * s} ${points[2] * s} ${points[3] * s} ${points[4] * s} ${points[5] * s}`;
            }),
          },
          0,
        );
      }
      tl.init();
      anims.push(tl);
    };

    root.querySelectorAll<SVGSVGElement>("[data-shape]").forEach(animateShape);
    return () => {
      alive = false;
      anims.forEach((a) => a.cancel());
    };
  }, []);

  const TRI = "48 17.28 86.4 80.11584 9.6 80.11584";
  return (
    <div ref={rootRef} className={`relative flex items-center justify-center ${className}`}>
      {/* 작은 채움 도형 (빨강) */}
      <svg data-shape className="absolute h-7 w-7 overflow-visible fill-nred stroke-nred stroke-2" viewBox="0 0 96 96">
        <rect width="48" height="48" x="24" y="24" fillRule="evenodd" strokeLinecap="square" />
      </svg>
      <svg data-shape className="absolute h-7 w-7 overflow-visible fill-nred stroke-nred stroke-2" viewBox="0 0 96 96">
        <polygon fillRule="evenodd" points={TRI} strokeLinecap="square" />
      </svg>
      <svg data-shape className="absolute h-7 w-7 overflow-visible fill-nred stroke-nred stroke-2" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="32" fillRule="evenodd" strokeLinecap="square" />
      </svg>
      {/* 큰 아웃라인 도형 (흰색) */}
      <svg data-shape className="absolute h-32 w-32 overflow-visible fill-transparent stroke-white/80 stroke-2" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="28" fillRule="evenodd" strokeLinecap="square" />
      </svg>
      <svg data-shape className="absolute h-32 w-32 overflow-visible fill-transparent stroke-white/80 stroke-2" viewBox="0 0 96 96">
        <rect width="48" height="48" x="24" y="24" fillRule="evenodd" strokeLinecap="square" />
      </svg>
      <svg data-shape className="absolute h-32 w-32 overflow-visible fill-transparent stroke-white/80 stroke-2" viewBox="0 0 96 96">
        <polygon fillRule="evenodd" points={TRI} strokeLinecap="square" />
      </svg>
    </div>
  );
}
