"use client";

// 게임 시작 인트로 — "e스포츠 매치업 카드" 스타일.
// 딥 그라디언트 진영 패널이 중앙 수직 심(seam)에서 충돌하고, 패널 속에는
// 실제 이번 판의 Voronoi 맵과 A/B 모노그램이 패럴랙스로 흐른다.
// VS(Audiowide) 팝인 + 샤인 스윕, 그 아래 "DAY 1 · 지역 N곳" 인포 스트립.

import { useEffect, useRef } from "react";
import { createTimeline } from "animejs";
import { useGameStore } from "@/store/gameStore";
import { soundManager } from "@/audio/soundManager";
import { CLIP_RADIUS } from "@/engine/voronoi";

interface Props {
  onDone: () => void;
}

// 중앙 수직 절단면 — 얇은 어두운 심(폭 1.6%)이 정확히 화면 중앙에 놓여
// VS·인포 스트립·양 진영이 좌우 완전 대칭이 된다.
const LEFT_CLIP = "polygon(0 0, 49.2% 0, 49.2% 100%, 0 100%)";
const RIGHT_CLIP = "polygon(50.8% 0, 100% 0, 100% 100%, 50.8% 100%)";

// 이번 판의 실제 맵 — 스토어 폴리곤을 은은한 선화 워터마크로
function MapWatermark() {
  const polygons = useGameStore((s) => s.polygons);
  const V = CLIP_RADIUS * 1.02;
  if (!polygons.length) return null;
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`${-V} ${-V} ${2 * V} ${2 * V}`}
      preserveAspectRatio="xMidYMid slice"
      style={{ opacity: 0.05 }}
      aria-hidden
    >
      {polygons.map((poly, i) =>
        poly.length > 0 ? (
          <polygon key={i} points={poly.map((p) => p.join(",")).join(" ")} fill="none" stroke="#fff" strokeWidth={50} />
        ) : null,
      )}
    </svg>
  );
}

// 이름 글자 스태거용 스팬 분할
function NameChars({ name }: { name: string }) {
  return (
    <>
      {[...name].map((ch, i) => (
        <span key={i} data-nm-ch className="inline-block opacity-0">
          {ch === " " ? " " : ch}
        </span>
      ))}
    </>
  );
}

export default function GameIntro({ onDone }: Props) {
  const names = useGameStore((s) => s.names);
  const nCells = useGameStore((s) => s.map?.n ?? 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    soundManager.play("game-start");
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    doneRef.current = false;
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    };
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const q = (sel: string) => root.querySelector(sel);
    const qa = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
    const tl = createTimeline({ defaults: { ease: "outExpo" }, onComplete: finish });

    const left = q("[data-i='left']");
    const right = q("[data-i='right']");
    const parL = q("[data-i='parL']");
    const parR = q("[data-i='parR']");
    const vs = q("[data-i='vs']");
    const shine = q("[data-i='shine']");
    const info = q("[data-i='info']");
    const flash = q("[data-i='flash']");

    // 1) 패널 슬램인 — 내부 패럴랙스 층은 더 멀리서 더 늦게 멈춰 깊이감
    if (left) tl.add(left, { translateX: ["-100%", "0%"], opacity: [{ to: 1, duration: 150 }], duration: 560 }, 60);
    if (right) tl.add(right, { translateX: ["100%", "0%"], opacity: [{ to: 1, duration: 150 }], duration: 560 }, 60);
    if (parL) tl.add(parL, { translateX: ["-12%", "0%"], duration: 700, ease: "outQuint" }, 60);
    if (parR) tl.add(parR, { translateX: ["12%", "0%"], duration: 700, ease: "outQuint" }, 60);

    // 2) 착지 임팩트 — 짧은 플래시 + 미세 쉐이크 (모션 최소화 설정이면 생략)
    if (!rm && flash) {
      tl.add(flash, { opacity: [{ to: 0.18, duration: 60, ease: "linear" }, { to: 0, duration: 60, ease: "linear" }] }, 440);
      tl.add(root, {
        translateX: [{ to: -4, duration: 50 }, { to: 3, duration: 50 }, { to: 0, duration: 40 }],
        ease: "linear",
      }, 440);
    }

    // 3) VS 팝인 (Audiowide + 금빛 글로우)
    if (vs) tl.add(vs, { scale: [3.4, 1], opacity: [0, 1], duration: 420, ease: "outBack" }, 480);

    // 4) 이름 글자 스태거 (패널별)
    (["[data-nm='0']", "[data-nm='1']"] as const).forEach((sel) => {
      qa(`${sel} [data-nm-ch]`).forEach((el, i) => {
        tl.add(el, { opacity: [0, 1], translateY: [14, 0], duration: 260, ease: "outCubic" }, 520 + i * 30);
      });
    });

    // 5) VS 샤인 스윕 + 인포 스트립
    // 끝 위치를 넉넉히(+220%) 밀어 VS 박스(overflow-hidden) 밖으로 완전히 빠져나가게 — 정착 프레임에 잔상 없음
    if (!rm && shine) tl.add(shine, { translateX: ["-150%", "220%"], duration: 250, ease: "inOutQuad" }, 600);
    if (info) tl.add(info, { opacity: [0, 1], translateY: [10, 0], duration: 300, ease: "outCubic" }, 640);

    // 6) 정착 후 드리프트 — 정지화면이 아니라 숨쉬는 프레임
    if (left) tl.add(left, { scale: [1, 1.015], duration: 1600, ease: "linear" }, 700);
    if (right) tl.add(right, { scale: [1, 1.015], duration: 1600, ease: "linear" }, 700);
    if (parL) tl.add(parL, { translateX: "1.5%", duration: 1600, ease: "linear" }, 700);
    if (parR) tl.add(parR, { translateX: "-1.5%", duration: 1600, ease: "linear" }, 700);

    // 7) 페이드아웃 → 게임으로
    tl.add(root, { opacity: [1, 0], duration: 340, ease: "inQuad" }, 2300);
    return () => {
      tl.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 cursor-pointer overflow-hidden bg-chrome"
      onClick={() => {
        doneRef.current = true;
        onDone();
      }}
    >
      {/* 중앙 비네트 — 사선 띠가 더 깊어 보이게 */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0.35), transparent 70%)" }}
      />

      {/* 왼쪽(빨강) 패널 래퍼 — 그라디언트 본판 + 패럴랙스 층 */}
      <div data-i="left" className="absolute inset-0 opacity-0">
        <div
          className="absolute inset-0"
          style={{ clipPath: LEFT_CLIP, background: "linear-gradient(135deg, var(--color-nred), var(--color-nreddark))" }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(circle at 0% 100%, rgba(0,0,0,0.35), transparent 55%)" }}
          />
          <div data-i="parL" className="absolute" style={{ inset: "-15%" }}>
            <MapWatermark />
            <span
              className="font-title absolute right-[22%] top-1/2 -translate-y-1/2 text-[55vmin] leading-none text-white/[0.08]"
              aria-hidden
            >
              A
            </span>
          </div>
          <div data-nm="0" className="absolute left-0 top-0 grid h-full w-[43%] place-items-center">
            <div className="flex max-w-[90%] flex-col items-center gap-3 text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
              <span className="font-title text-sm tracking-[0.3em] text-white/70">PLAYER A</span>
              <span className="break-keep text-center text-[clamp(28px,4.4vmin,52px)] font-bold leading-tight">
                <NameChars name={names[0]} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 오른쪽(파랑) 패널 래퍼 */}
      <div data-i="right" className="absolute inset-0 opacity-0">
        <div
          className="absolute inset-0"
          style={{ clipPath: RIGHT_CLIP, background: "linear-gradient(315deg, var(--color-nblue), var(--color-nbluedark))" }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(circle at 100% 0%, rgba(0,0,0,0.35), transparent 55%)" }}
          />
          <div data-i="parR" className="absolute" style={{ inset: "-15%" }}>
            <MapWatermark />
            <span
              className="font-title absolute left-[22%] top-1/2 -translate-y-1/2 text-[55vmin] leading-none text-white/[0.08]"
              aria-hidden
            >
              B
            </span>
          </div>
          <div data-nm="1" className="absolute right-0 top-0 grid h-full w-[43%] place-items-center">
            <div className="flex max-w-[90%] flex-col items-center gap-3 text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
              <span className="font-title text-sm tracking-[0.3em] text-white/70">PLAYER B</span>
              <span className="break-keep text-center text-[clamp(28px,4.4vmin,52px)] font-bold leading-tight">
                <NameChars name={names[1]} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 중앙: VS + 인포 스트립 */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center">
          <span
            data-i="vs"
            // 9vmin ≈ FHD(1080)에서 기존 text-8xl(96px)과 동일 — 작은 화면에선 비례 축소
            className="font-title relative overflow-hidden px-4 text-[clamp(52px,9vmin,112px)] text-white opacity-0"
            style={{ textShadow: "0 2px 24px rgba(0,0,0,0.6), 0 0 32px rgba(240,180,41,0.4)" }}
          >
            VS
            <span
              data-i="shine"
              className="absolute inset-y-0 left-0 w-1/2"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                // 시작 위치·기울기를 transform 하나로 — animejs가 translateX만 갈아끼우고 skew는 유지
                transform: "translateX(-150%) skewX(-20deg)",
              }}
            />
          </span>
          <div
            data-i="info"
            className="rounded-full border border-chromeline bg-chrome/70 px-4 py-1.5 text-[13px] tracking-[0.2em] text-chromedim opacity-0"
          >
            DAY 1 <span className="text-ngold">·</span> 지역 {nCells}곳
          </div>
        </div>
      </div>

      {/* 임팩트 플래시 */}
      <div data-i="flash" className="pointer-events-none absolute inset-0 bg-white opacity-0" />
    </div>
  );
}
