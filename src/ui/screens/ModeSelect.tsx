"use client";

// 시작 화면 — 풀스크린 다크 메뉴(큼직한 가로 행) + 레이어 전환식 설정 패널.
// 배경에는 매번 새로 생성한 Voronoi 맵을 희미하게 깔아 게임 정체성을 잇는다.
// 게임 화면과 같은 크롬 팔레트(chrome/chrome2/nred/nblue/ngold)를 그대로 사용.

import { useCallback, useEffect, useRef, useState } from "react";
import { createTimeline, cubicBezier } from "animejs";
import { useGameStore } from "@/store/gameStore";
import { fetchBots } from "@/bridge/client";
import { loadSession } from "@/online/roomClient";
import { WS_URL } from "@/online/config";
import ConfirmDialog from "@/ui/ConfirmDialog";
import LoadingOverlay from "@/ui/LoadingOverlay";
import ShapesLoader from "@/ui/ShapesLoader";
import SoundToggles from "@/ui/SoundToggles";
import RulesOverlay from "@/ui/RulesOverlay";
import { soundManager } from "@/audio/soundManager";
import { generateMap } from "@/engine/mapgen";
import { computeCellPolygons, CLIP_RADIUS, type Polygon } from "@/engine/voronoi";
import type { Side } from "@/engine/types";

type View = "menu" | "hotseat" | "bridge" | "online" | "onlineWait";

// 턴 제한 선택지 — 인터넷·인공지능 대전용 ('없음'은 잠수 시 게임이 멈춰서 제공하지 않음)
const TURN_LIMIT_OPTIONS = [
  { value: "30", label: "30초" },
  { value: "60", label: "60초" },
  { value: "120", label: "120초" },
];
// 로컬(핫시트)은 같은 자리에서 번갈아 하므로 '없음' 허용
const LOCAL_TURN_LIMIT_OPTIONS = [{ value: "0", label: "없음" }, ...TURN_LIMIT_OPTIONS];

// 맵 크기 = 고정값이 아니라 구간 — 선택한 구간 안에서 (시드 rng로) 랜덤 추첨된다.
// NP ∈ [25,54], 지역 수 N = 2·NP+1 (51~109).
const SIZE_CHOICES: Record<string, { label: string; np?: number; npRange?: [number, number] }> = {
  random: { label: "랜덤" },
  min: { label: "최소 (51지역)", np: 25 },
  small: { label: "작음 (51~69지역)", npRange: [25, 34] },
  medium: { label: "중간 (71~89지역)", npRange: [35, 44] },
  large: { label: "큼 (91~109지역)", npRange: [45, 54] },
  max: { label: "최대 (109지역)", np: 54 },
};
const SIZE_OPTIONS = Object.entries(SIZE_CHOICES).map(([value, c]) => ({ value, label: c.label }));

const inputCls = "rounded-lg border border-chromeline bg-chrome px-3 py-2";

/* ── 배경: 희미한 Voronoi 맵 (마운트 후 랜덤 생성 — SSR 불일치 방지) ── */
function MenuBackdrop() {
  const [polys, setPolys] = useState<Polygon[] | null>(null);
  useEffect(() => {
    const map = generateMap({ np: 40, seed: Math.floor(Math.random() * 1e9) });
    setPolys(computeCellPolygons(map));
  }, []);
  if (!polys) return null;
  const V = CLIP_RADIUS * 1.02;
  return (
    <svg
      // 투명도는 backdrop-enter 키프레임(0→0.055)이 담당 — screen-enter를 쓰면
      // fill 채움값(opacity:1)이 인라인 opacity를 덮어 배경이 쨍하게 떠버린다
      className="backdrop-enter pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`${-V} ${-V} ${2 * V} ${2 * V}`}
      preserveAspectRatio="xMidYMid slice"
      style={{
        maskImage: "radial-gradient(ellipse at center, black 30%, transparent 78%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 78%)",
      }}
    >
      {polys.map((poly, i) =>
        poly.length > 0 ? (
          <polygon key={i} points={poly.map((p) => p.join(",")).join(" ")} fill="none" stroke="#fff" strokeWidth={50} />
        ) : null,
      )}
    </svg>
  );
}

/* ── NEXT NATION 타이틀 — Audiowide 디스플레이 폰트, 글자별 스태거 등장용 스팬 분할 ── */
const LOGO_TEXT = "NEXT NATION";

function LogoText({ intro }: { intro: boolean }) {
  return (
    <span className="font-title text-6xl tracking-[0.08em]">
      {[...LOGO_TEXT].map((ch, i) => (
        <span key={i} data-logo-ch className="inline-block" style={intro ? { opacity: 0 } : undefined}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

/* ── 메뉴 행 ── */
function MenuRow({
  icon,
  title,
  desc,
  accentBar,
  accentHover,
  delay,
  intro,
  disabled,
  compact, // 반폭(한 줄에 둘) — 작은 보조 항목용
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  accentBar: string; // 왼쪽 색 바 (예: "bg-nred")
  accentHover: string; // hover 보더 (예: "hover:border-nred/70")
  delay: number;
  intro?: boolean; // 오프닝 시퀀스 중 — CSS 등장 대신 animejs가 연출 (초기 숨김)
  disabled?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-menurow
      data-sfx="menu-click" // 메뉴 선택 = 도톰한 팝(시작 화면 예외)
      className={`${intro ? "" : "row-enter"} group relative flex items-center overflow-hidden rounded-xl border border-chromeline bg-chrome2/80 text-left backdrop-blur transition-all duration-150 enabled:cursor-pointer enabled:hover:translate-x-2 enabled:hover:bg-chrome2 disabled:opacity-40 ${accentHover} ${
        compact ? "min-w-0 flex-1 gap-4 py-4 pl-6 pr-5" : "w-full gap-5 py-5 pl-8 pr-6"
      }`}
      style={intro ? { opacity: 0 } : { animationDelay: `${delay}ms` }}
      disabled={disabled}
      onMouseEnter={disabled ? undefined : () => soundManager.play("ui-hover")}
      onClick={onClick}
    >
      <span className={`absolute left-0 top-0 h-full w-1.5 transition-all duration-150 group-enabled:group-hover:w-2.5 ${accentBar}`} />
      <span className={compact ? "text-3xl" : "text-4xl"}>{icon}</span>
      <span className="min-w-0 flex-1">
        <b className={`block font-semiblack tracking-wide ${compact ? "text-xl leading-tight" : "text-2xl"}`}>{title}</b>
        <span
          className={`block text-sm text-chromedim ${compact ? "mt-0.75 truncate leading-tight" : "mt-0.5 leading-relaxed"}`}
        >
          {desc}
        </span>
      </span>
      <span className="text-lg text-chromedim transition-all duration-150 group-enabled:group-hover:translate-x-1 group-enabled:group-hover:text-white">
        ▶
      </span>
    </button>
  );
}

/* ── 설정 행 ── */
function SettingRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-6 px-6 py-4">
      <span className="text-sm font-bold">{label}</span>
      {children}
    </label>
  );
}

/* ── 커스텀 드롭다운 — 네이티브 <select> 팝업 대신 게임 팔레트로 직접 렌더 ── */
function Select({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // 키보드 하이라이트 인덱스
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setHi(options.findIndex((o) => o.value === value));
    setOpen((v) => !v);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[hi];
      if (o) {
        onChange(o.value);
        setOpen(false);
      }
    }
  };

  const sel = options.find((o) => o.value === value);
  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-chromeline bg-chrome px-3 py-2 text-left transition hover:border-zinc-500"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>{sel?.label ?? "선택"}</span>
        <span className={`text-[10px] text-chromedim transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="dropdown-enter absolute right-0 top-full z-30 mt-1.5 min-w-full overflow-hidden rounded-lg border border-chromeline bg-chrome2 py-1 shadow-2xl"
        >
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                className={`flex w-full cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm ${
                  i === hi ? "bg-chrome" : ""
                } hover:bg-chrome ${o.value === value ? "font-bold text-ngold" : ""}`}
                onPointerEnter={() => setHi(i)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className={`w-4 text-center ${o.value === value ? "" : "opacity-0"}`}>✓</span>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 오프닝 시퀀스(타이틀 정중앙 → 제자리 + 메뉴 슬라이드인)는 페이지 로드당 1회 —
// 게임에서 메뉴로 돌아올 땐(컴포넌트 재마운트) 짧은 기본 등장만 쓴다.
let introShown = false;

export default function ModeSelect() {
  const loadReplay = useGameStore((s) => s.loadReplay);
  const startHotseat = useGameStore((s) => s.startHotseat);
  const startBridge = useGameStore((s) => s.startBridge);
  const [view, setView] = useState<View>("menu");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("로딩 중…");
  const [cancellable, setCancellable] = useState(false);
  const [sizeKey, setSizeKey] = useState("random");
  const [seedText, setSeedText] = useState("");
  const [nameA, setNameA] = useState("");
  const [nameB, setNameB] = useState("");
  const [bridgeBots, setBridgeBots] = useState<{ id: string; nameKo: string }[]>([]);
  const [bridgeBotId, setBridgeBotId] = useState("");
  const [humanSide, setHumanSide] = useState<Side>(0);

  // 인터넷 대전
  const startOnlineHost = useGameStore((s) => s.startOnlineHost);
  const startOnlineJoin = useGameStore((s) => s.startOnlineJoin);
  const rejoinOnline = useGameStore((s) => s.rejoinOnline);
  const cancelOnlineWait = useGameStore((s) => s.cancelOnlineWait);
  const hasOnlineSession = useGameStore((s) => s.hasOnlineSession);
  const [onlineNick, setOnlineNick] = useState("");
  const [onlineRole, setOnlineRole] = useState<"host" | "join">("host");
  const [joinCode, setJoinCode] = useState("");
  const [turnLimitKey, setTurnLimitKey] = useState("60"); // 인터넷·인공지능 대전 공용
  const [hotseatLimitKey, setHotseatLimitKey] = useState("0"); // 로컬 대전 (기본: 없음)
  const [waitCode, setWaitCode] = useState(""); // 초대 후 대기 화면에 표시할 방 번호
  const [codeCopied, setCodeCopied] = useState(false);
  const [canRejoin, setCanRejoin] = useState(false); // 진행 중 대전 세션 존재 (effect에서 — SSR 안전)
  const [rejoinDismissed, setRejoinDismissed] = useState(false); // 재접속 안내를 이번 방문에서 닫음
  useEffect(() => {
    setCanRejoin(hasOnlineSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 오프닝 시퀀스 — 마운트 시점에 1회 결정. 다른 화면으로 이동하는 순간 해제해서
  // (goView) 메뉴로 돌아왔을 때 intro용 초기 숨김(opacity 0)이 남지 않게 한다.
  const [intro, setIntro] = useState(() => !introShown);
  // 인트로 시퀀스 종료 여부 — 인트로 뒤에만 등장할 부가 요소(재접속 배너 등)용
  const [introPlayed, setIntroPlayed] = useState(() => introShown);
  // 시작 게이트 — 타이틀만 정중앙에 띄우고 첫 클릭을 기다린다 (자동재생 unlock 겸용)
  const [gate, setGate] = useState(() => !introShown);
  // "클릭하여 시작"이 실제로 나타난 뒤에만 클릭·키로 진행 (프롬프트 등장 전 클릭 시 멘트가 떴다 사라지는 어색함 방지)
  const [gateReady, setGateReady] = useState(false);

  // 허용 외 URL 파라미터 안내 (오타 방지 — 예: 옛 이름 ?serverbot). SSR 불일치 방지 위해 effect에서.
  const [paramWarning, setParamWarning] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false); // ?local — 오프라인 모드 (인터넷 대전 비활성)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsLocal(params.has("local"));
    const known = new Set(["local"]);
    const unknown = [...params.keys()].filter((k) => !known.has(k));
    if (unknown.length > 0) {
      setParamWarning(
        `알 수 없는 URL 파라미터: ${unknown.map((k) => `?${k}`).join(", ")} — 사용 가능한 파라미터는 ?local (오프라인 모드) 뿐입니다`,
      );
    }
  }, []);

  // 기본 모드에서 인터넷 대전 서버(worker) 생존 확인 — 미발견이면 안내 후 ?local로 재시작
  const [showRules, setShowRules] = useState(false);
  const [serverGone, setServerGone] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("local")) return;
    let cancelled = false; // StrictMode 재마운트의 cleanup abort를 실패로 오인하지 않게
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    // ws(s)→http(s)로 바꿔 루트에 GET — 워커 "/"가 CORS+CORP 헤더와 함께 200을 준다.
    // (이 페이지는 COEP: require-corp라 CORP 없는 교차 출처 응답은 차단돼 오탐이 난다)
    fetch(WS_URL.replace(/^ws/, "http") + "/", { signal: ctrl.signal })
      .catch(() => {
        if (!cancelled) setServerGone(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!serverGone) return;
    const t = setTimeout(() => window.location.replace("/?local"), 2800);
    return () => clearTimeout(t);
  }, [serverGone]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subRef = useRef<HTMLParagraphElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null); // 우하단 사운드 토글·모드 링크 (Phase B에 페이드인)
  const gateDoneRef = useRef(false); // Enter 키(keydown+click 동시 발화) 이중 실행 가드

  // 대기실 루프음 — 뷰 이탈뿐 아니라 게임 시작(ModeSelect 언마운트)에서도 cleanup으로 꺼진다
  useEffect(() => {
    soundManager.setWaitLoop(view === "onlineWait");
    return () => soundManager.setWaitLoop(false);
  }, [view]);

  useEffect(() => {
    if (!intro) return;
    const title = titleRef.current;
    const sub = subRef.current;
    const nav = navRef.current;
    if (!title || !sub || !nav) return;

    // 타이틀의 최종 위치 → 화면 정중앙까지의 세로 오프셋 (FLIP)
    // 재마운트(StrictMode) 시 잔여 inline transform이 측정을 오염시키지 않게 먼저 초기화
    title.style.transform = "";
    const rect = title.getBoundingClientRect();
    const delta = window.innerHeight / 2 - (rect.top + rect.height / 2);
    title.style.transform = `translateY(${delta}px)`;
    nav.style.pointerEvents = "none"; // 등장 전 투명한 행이 클릭받지 않게

    const rows = [...nav.querySelectorAll<HTMLElement>("[data-menurow]")];
    // ⚠ 행 버튼의 hover용 transition-all이 animejs의 프레임별 transform 쓰기를
    // 가로채 슬라이드가 뭉개진다 — 인트로 동안은 트랜지션을 끈다
    rows.forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "";
    });

    // Phase A: 정중앙에서 타이틀 글자가 한 자씩 떠오르고 "클릭하여 시작"이 나타난다.
    // 메뉴 등장(Phase B)은 게이트 클릭(startFromGate)이 이어받는다.
    const tl = createTimeline({ defaults: { ease: "outQuad" } });
    const chars = [...title.querySelectorAll<HTMLElement>("[data-logo-ch]")];
    chars.forEach((el, i) => {
      tl.add(el, { opacity: [0, 1], translateY: [26, 0], duration: 480, ease: "outCubic" }, 150 + i * 55);
    });
    // 프롬프트가 다 뜬 뒤에야 클릭/키 진행을 허용 (onComplete = 페이드인 완료 시점)
    if (promptRef.current)
      tl.add(promptRef.current, { opacity: [0, 1], duration: 500, onComplete: () => setGateReady(true) }, 1150);
    return () => {
      tl.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 게이트 클릭 → 시작 효과음 + Phase B(타이틀 상승·메뉴 슬라이드인).
  // 이 클릭이 브라우저 자동재생 unlock을 겸해 BGM도 이 순간부터 흐른다.
  const startFromGate = useCallback(() => {
    if (!gate || !gateReady || gateDoneRef.current) return; // 프롬프트 등장 전 클릭·키는 무시
    gateDoneRef.current = true;
    setGate(false);
    soundManager.play("game-start");
    const title = titleRef.current;
    const sub = subRef.current;
    const nav = navRef.current;
    if (!title || !sub || !nav) return;
    const rows = [...nav.querySelectorAll<HTMLElement>("[data-menurow]")];
    const inOut = cubicBezier(0.85, 0, 0.15, 1); // 천천히 출발, 중간 가속, 부드럽게 안착
    const tl = createTimeline({
      defaults: { ease: "outQuad" },
      onComplete: () => {
        introShown = true;
        setIntroPlayed(true);
        nav.style.pointerEvents = "";
        rows.forEach((el) => {
          el.style.transition = ""; // hover 트랜지션 복원
          // animejs가 남긴 인라인 opacity/transform 해제 — 인라인 값이 남아 있으면
          // disabled:opacity-40 같은 클래스 스타일을 영구히 덮어버린다
          el.style.opacity = "";
          el.style.transform = "";
        });
        if (cornerRef.current) cornerRef.current.style.opacity = "";
      },
    });
    if (promptRef.current) tl.add(promptRef.current, { opacity: 0, duration: 220 }, 0);
    tl.add(title, { translateY: 0, duration: 620, ease: inOut }, 80);
    tl.add(sub, { opacity: [0, 1], translateY: [10, 0], duration: 420 }, 380);
    rows.forEach((el, i) => {
      // 화면 왼쪽 끝과 제자리의 중간 지점에서 페이드인하며 슬라이드 (뷰포트 크기에 맞춰 계산)
      const r = el.getBoundingClientRect();
      const fromX = -(r.left - 32) / 2;
      tl.add(el, { opacity: [0, 1], translateX: [fromX, 0], duration: 700, ease: inOut }, 280 + i * 110);
    });
    // 우하단 사운드 토글·모드 링크도 행들과 함께 페이드인
    if (cornerRef.current) tl.add(cornerRef.current, { opacity: [0, 1], duration: 500, ease: inOut }, 500);
  }, [gate, gateReady]);

  // 게이트 중에는 아무 키로도 시작 가능 (키 입력도 자동재생 unlock 제스처)
  useEffect(() => {
    if (!gate) return;
    const onKey = () => startFromGate();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gate, startFromGate]);

  // 비동기 작업(봇 목록·데모 로드·세션 생성) 스테일 가드 — 화면 이동/새 작업 시 토큰을
  // 올려서, 늦게 도착한 응답이 화면을 납치하거나 엉뚱한 곳에 에러를 띄우지 못하게 한다.
  const reqRef = useRef(0);
  const viewRef = useRef<View>("menu");
  const goView = useCallback((v: View) => {
    reqRef.current += 1; // 진행 중이던 요청은 전부 무효화
    viewRef.current = v;
    setIntro(false);
    setIntroPlayed(true);
    setError(null);
    setLoading(false);
    setView(v);
  }, []);

  const openBridge = useCallback(async () => {
    const token = ++reqRef.current;
    setError(null);
    setLoadingMsg("봇 명단을 확인하는 중…");
    setCancellable(false);
    setLoading(true); // 대기 중엔 메뉴 행 전체 비활성 (아래 disabled={loading})
    try {
      const bots = await fetchBots();
      if (reqRef.current !== token) return; // 그 사이 다른 곳으로 이동함
      setBridgeBots(bots);
      setBridgeBotId(bots[0]?.id ?? "");
      goView("bridge"); // intro 해제·상태 정리 포함 (loading은 goView가 끈다)
    } catch (e) {
      if (reqRef.current !== token) return;
      // 기본은 Pyodide, 불가 시 서버 브리지 폴백 — 여기 도달 = 둘 다 불가한 환경
      setError(e instanceof Error ? e.message : "인공지능 대전을 사용할 수 없는 환경입니다");
    } finally {
      if (reqRef.current === token) setLoading(false);
    }
  }, []);

  const loadDemo = useCallback(async () => {
    const token = ++reqRef.current;
    setLoadingMsg("전장 기록을 불러오는 중…");
    setCancellable(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/logs/sample-2200.txt");
      const text = await res.text();
      if (reqRef.current !== token || viewRef.current !== "menu") return;
      const r = loadReplay(text);
      if (!r.ok) setError(r.error ?? "로그 파싱 실패");
    } catch (e) {
      if (reqRef.current !== token) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (reqRef.current === token) setLoading(false);
    }
  }, [loadReplay]);

  const begin = useCallback(async () => {
    const trimmed = seedText.trim();
    let seed: number | undefined;
    if (trimmed !== "") {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        setError("시드는 숫자여야 합니다");
        return;
      }
      seed = n;
    }
    const size = SIZE_CHOICES[sizeKey] ?? SIZE_CHOICES.random;
    if (view === "hotseat")
      startHotseat({
        np: size.np,
        npRange: size.npRange,
        seed,
        nameA,
        nameB,
        turnLimit: Number(hotseatLimitKey) as 0 | 30 | 60 | 120,
      });
    else if (view === "bridge") {
      const token = ++reqRef.current;
      setLoadingMsg("봇을 전장으로 소환하는 중…");
      setCancellable(true); // Pyodide 웜업이 길어질 수 있음 — 취소 허용
      setLoading(true);
      setError(null);
      const botName = bridgeBots.find((b) => b.id === bridgeBotId)?.nameKo ?? "봇";
      const r = await startBridge({
        np: size.np,
        npRange: size.npRange,
        seed,
        turnLimit: Number(turnLimitKey) as 0 | 30 | 60 | 120,
        humanSide,
        botId: bridgeBotId,
        botName,
        isCancelled: () => reqRef.current !== token, // "메뉴로"로 나가면 세션 정리 후 조용히 취소
      });
      if (reqRef.current !== token) return;
      setLoading(false);
      if (!r.ok && !r.cancelled) setError(r.error ?? "봇 세션 생성 실패");
    } else if (view === "online") {
      const token = ++reqRef.current;
      setError(null);
      if (onlineRole === "host") {
        setLoadingMsg("방을 만드는 중…");
        setCancellable(false);
        setLoading(true);
        const r = await startOnlineHost({
          nick: onlineNick.trim(),
          np: size.np,
          npRange: size.npRange,
          seed,
          turnLimit: Number(turnLimitKey) as 0 | 30 | 60 | 120,
          isCancelled: () => reqRef.current !== token,
        });
        if (reqRef.current !== token) return;
        setLoading(false);
        if (r.ok && r.code) {
          setWaitCode(r.code);
          setCodeCopied(false);
          viewRef.current = "onlineWait";
          setView("onlineWait"); // goView는 reqRef를 올려 방 생성을 취소시키므로 직접 전환
        } else if (!r.cancelled) {
          setError(r.error ?? "방 생성 실패");
        }
      } else {
        if (!/^\d{6}$/.test(joinCode)) {
          setError("방 번호는 숫자 6자리입니다");
          return;
        }
        setLoadingMsg("방에 연결하는 중…");
        setCancellable(true);
        setLoading(true);
        const r = await startOnlineJoin({
          nick: onlineNick.trim(),
          code: joinCode,
          isCancelled: () => reqRef.current !== token,
        });
        if (reqRef.current !== token) return;
        setLoading(false);
        if (!r.ok && !r.cancelled) setError(r.error ?? "입장 실패");
        // 성공 시 스토어가 게임 화면으로 전환 (이 컴포넌트는 언마운트)
      }
    }
  }, [view, startHotseat, startBridge, startOnlineHost, startOnlineJoin, sizeKey, seedText, nameA, nameB, humanSide, bridgeBotId, bridgeBots, onlineRole, onlineNick, joinCode, turnLimitKey, hotseatLimitKey]);

  const doRejoin = useCallback(async () => {
    const token = ++reqRef.current;
    setLoadingMsg("대전에 재접속하는 중…");
    setCancellable(false);
    setLoading(true);
    setError(null);
    const r = await rejoinOnline();
    if (reqRef.current !== token) return;
    setLoading(false);
    if (!r.ok) {
      setCanRejoin(false);
      setError(r.error ?? "재접속 실패");
    }
    // 성공: 게임 화면 전환(플레이 중) — 로비였다면 세션의 방 번호로 대기 화면 복귀
    const after = useGameStore.getState();
    if (r.ok && after.screen === "menu") {
      setWaitCode(loadSession()?.code ?? "");
      viewRef.current = "onlineWait";
      setView("onlineWait");
    }
  }, [rejoinOnline]);

  // 공통 설정 행 (맵 크기·시드)
  const commonRows = (
    <>
      <SettingRow label="맵 크기">
        <Select className="w-52" value={sizeKey} options={SIZE_OPTIONS} onChange={setSizeKey} />
      </SettingRow>
      <SettingRow label="시드 (선택)">
        <input
          className={`${inputCls} w-52`}
          placeholder="비우면 랜덤"
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
        />
      </SettingRow>
    </>
  );

  return (
    <main className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#17181c] to-[#22232a]">
      <MenuBackdrop />

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center px-6">
        {view === "menu" ? (
          <div key="menu" className="flex w-full flex-col items-center">
            <h1
              ref={titleRef}
              className={`${intro ? "" : "screen-enter"} m-0 text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]`}
            >
              <LogoText intro={intro} />
            </h1>
            <p
              ref={subRef}
              className={`${intro ? "" : "screen-enter"} mt-3 text-chromedim`}
              style={intro ? { opacity: 0 } : { animationDelay: "60ms" }}
            >
              NYPC 2026 Master Track - 2인 동시턴 게임 웹 플레이어
            </p>

            <nav ref={navRef} className="mt-12 flex w-full flex-col gap-6">
              <MenuRow
                icon="⚔️"
                title="로컬 대전"
                desc="한 화면에서 두 사람이 번갈아 명령을 내리는 2인 대결"
                accentBar="bg-nred"
                accentHover="enabled:hover:border-nred/70"
                delay={120}
                intro={intro}
                disabled={loading}
                onClick={() => goView("hotseat")}
              />
              <MenuRow
                icon="🤖"
                title="인공지능 대전"
                desc="봇과 직접 대결"
                accentBar="bg-nblue"
                accentHover="enabled:hover:border-nblue/70"
                delay={190}
                intro={intro}
                disabled={loading}
                onClick={() => void openBridge()}
              />
              <MenuRow
                icon="🌐"
                title="인터넷 대전"
                desc={isLocal ? "로컬 모드에서는 사용할 수 없습니다" : "방 번호로 친구와 실시간 온라인 대결"}
                accentBar="bg-emerald-500"
                accentHover="enabled:hover:border-emerald-500/70"
                delay={260}
                intro={intro}
                disabled={loading || isLocal}
                onClick={() => goView("online")}
              />
              {/* 보조 항목 — 한 줄에 둘 (반폭, 작게) */}
              <div className="flex gap-6">
                <MenuRow
                  icon="🎬"
                  title="데모 대결 보기"
                  desc="실전 한 판 구경"
                  accentBar="bg-ngold"
                  accentHover="enabled:hover:border-ngold/70"
                  delay={330}
                  intro={intro}
                  disabled={loading}
                  compact
                  onClick={() => void loadDemo()}
                />
                <MenuRow
                  icon="📖"
                  title="게임 규칙"
                  desc="처음이라면 여기서"
                  accentBar="bg-purple-500"
                  accentHover="enabled:hover:border-purple-400"
                  delay={400}
                  intro={intro}
                  disabled={loading}
                  compact
                  onClick={() => setShowRules(true)}
                />
              </div>
            </nav>

          </div>
        ) : view === "onlineWait" ? (
          <div key="onlineWait" className="panel-enter flex w-full flex-col items-center gap-6">
            {/* 대기실용 축소판 — scale로 도형·움직임 전체를 60%로 */}
            <ShapesLoader className="h-28 w-28 scale-[0.6]" />
            <h2 className="flex items-center gap-3 text-3xl font-bold tracking-wide">
              <span className="h-8 w-2 rounded-full bg-emerald-500" />
              상대를 기다리는 중
            </h2>
            <p className="text-chromedim">아래 방 번호를 상대에게 알려주세요</p>
            <div className="flex items-center gap-3">
              <span className="rounded-2xl border border-chromeline bg-chrome2 px-8 py-4 font-mono text-6xl font-bold tracking-[0.2em]">
                {waitCode}
              </span>
              <button
                className="cursor-pointer rounded-lg border border-chromeline bg-chrome2 px-3 py-2 text-sm text-chromedim transition hover:text-white"
                onClick={() => {
                  void navigator.clipboard?.writeText(waitCode).then(() => setCodeCopied(true));
                }}
              >
                {codeCopied ? "복사됨 ✓" : "복사"}
              </button>
            </div>
            <p className="animate-pulse text-sm text-chromedim">상대가 입장하면 자동으로 시작됩니다…</p>
            <button
              className="cursor-pointer rounded-lg border border-chromeline px-5 py-2 text-sm text-chromedim transition hover:text-white"
              onClick={() => {
                cancelOnlineWait();
                setCanRejoin(false);
                goView("menu");
              }}
            >
              취소하고 방 없애기
            </button>
          </div>
        ) : (
          <div key={view} className="panel-enter w-full">
            <button
              className="mb-5 flex cursor-pointer items-center gap-2 text-sm text-chromedim transition hover:text-white"
              onClick={() => goView("menu")}
            >
              ◀ 메뉴로
            </button>

            <h2 className="mb-6 flex items-center gap-3 text-4xl font-bold tracking-wide">
              <span
                className={`h-9 w-2 rounded-full ${
                  view === "hotseat" ? "bg-nred" : view === "online" ? "bg-emerald-500" : "bg-nblue"
                }`}
              />
              {view === "hotseat" ? "로컬 대전" : view === "online" ? "인터넷 대전" : "인공지능 대전"}
            </h2>

            <div className="flex flex-col divide-y divide-chromeline rounded-xl border border-chromeline bg-chrome2/80 backdrop-blur">
              {view === "hotseat" && (
                <>
                  <SettingRow
                    label={
                      <>
                        <b className="text-nred">A</b> 닉네임
                      </>
                    }
                  >
                    <input
                      className={`${inputCls} w-52`}
                      placeholder="플레이어 A"
                      maxLength={12}
                      value={nameA}
                      onChange={(e) => setNameA(e.target.value)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={
                      <>
                        <b className="text-nblue">B</b> 닉네임
                      </>
                    }
                  >
                    <input
                      className={`${inputCls} w-52`}
                      placeholder="플레이어 B"
                      maxLength={12}
                      value={nameB}
                      onChange={(e) => setNameB(e.target.value)}
                    />
                  </SettingRow>
                  <SettingRow label="턴 제한시간">
                    <Select className="w-52" value={hotseatLimitKey} options={LOCAL_TURN_LIMIT_OPTIONS} onChange={setHotseatLimitKey} />
                  </SettingRow>
                </>
              )}

              {view === "bridge" && (
                <>
                  <SettingRow label="상대 봇">
                    <Select
                      className="w-52"
                      value={bridgeBotId}
                      options={bridgeBots.map((b) => ({ value: b.id, label: b.nameKo }))}
                      onChange={setBridgeBotId}
                    />
                  </SettingRow>
                  <SettingRow label="내 진영">
                    <Select
                      className="w-52"
                      value={String(humanSide)}
                      options={[
                        { value: "0", label: "A (빨강 · 왼쪽)" },
                        { value: "1", label: "B (파랑 · 오른쪽)" },
                      ]}
                      onChange={(v) => setHumanSide(Number(v) as Side)}
                    />
                  </SettingRow>
                  <SettingRow label="턴 제한시간">
                    <Select className="w-52" value={turnLimitKey} options={TURN_LIMIT_OPTIONS} onChange={setTurnLimitKey} />
                  </SettingRow>
                </>
              )}

              {view === "online" && (
                <>
                  <SettingRow label="닉네임">
                    <input
                      className={`${inputCls} w-52`}
                      placeholder="플레이어"
                      maxLength={12}
                      value={onlineNick}
                      onChange={(e) => setOnlineNick(e.target.value)}
                    />
                  </SettingRow>
                  <SettingRow label="방식">
                    <div className="flex w-52 overflow-hidden rounded-lg border border-chromeline">
                      {(
                        [
                          ["host", "방 생성"],
                          ["join", "입장"],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          className={`flex-1 cursor-pointer py-2 text-sm transition ${
                            onlineRole === k ? "bg-emerald-600 font-bold text-white" : "bg-chrome text-chromedim hover:text-white"
                          }`}
                          onClick={() => setOnlineRole(k)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                  {onlineRole === "host" ? (
                    <SettingRow label="턴 제한시간">
                      <Select className="w-52" value={turnLimitKey} options={TURN_LIMIT_OPTIONS} onChange={setTurnLimitKey} />
                    </SettingRow>
                  ) : (
                    <SettingRow label="방 번호">
                      <input
                        className={`${inputCls} w-52 text-center font-mono text-lg tracking-[0.3em]`}
                        placeholder="000000"
                        inputMode="numeric"
                        maxLength={6}
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ""))}
                      />
                    </SettingRow>
                  )}
                </>
              )}

              {/* 입장자는 맵 설정 불필요 (호스트가 결정) */}
              {!(view === "online" && onlineRole === "join") && commonRows}
            </div>

            <button
              data-sfx="menu-click" // 게임 시작/방 만들기/입장 = 도톰한 팝
              className={`mt-6 w-full cursor-pointer rounded-xl py-4 text-xl font-black transition hover:brightness-110 disabled:opacity-50 ${
                view === "hotseat" ? "bg-nred" : view === "online" ? "bg-emerald-600" : "bg-nblue"
              }`}
              onClick={() => void begin()}
              disabled={loading || (view === "online" && onlineRole === "join" && joinCode.length !== 6)}
            >
              {loading
                ? "준비 중…"
                : view === "online"
                  ? onlineRole === "host"
                    ? "방 만들기"
                    : "입장"
                  : "시작"}
            </button>
          </div>
        )}

        {error && <p className="mt-5 text-center text-[#ff7b6e]">⚠ {error}</p>}
        {paramWarning && (
          <p className="mt-6 rounded-lg border border-ngold/40 bg-ngold/10 px-4 py-2 text-center text-[13px] text-ngold">
            ⚠ {paramWarning}
          </p>
        )}

      {/* 게임 규칙 오버레이 */}
      {showRules && <RulesOverlay onClose={() => setShowRules(false)} />}

      {/* 인터넷 대전 서버 미발견 — 안내 후 오프라인(?local) 모드로 재시작 */}
      {serverGone && (
        <div
          className="fixed inset-0 z-50 grid cursor-pointer place-items-center bg-black/60 backdrop-blur-sm"
          onClick={() => window.location.replace("/?local")}
        >
          <div className="dropdown-enter mx-6 max-w-md rounded-xl border border-chromeline bg-chrome2 p-6 text-center shadow-2xl">
            <div className="text-3xl">🔌</div>
            <p className="mt-3 font-bold leading-relaxed">
              인터넷 대결을 위한 서버가 발견되지 않았습니다.
              <br />
              로컬 모드로 재시작합니다.
            </p>
            <p className="mt-2 text-xs text-chromedim">잠시 후 자동으로 이동합니다 — 클릭하면 바로 이동</p>
          </div>
        </div>
      )}

      {/* 시작 게이트 — 첫 클릭이 자동재생 unlock을 겸한다 (클릭 전에는 브라우저가 소리를 막음) */}
      {gate && (
        <button
          data-no-sfx
          aria-label="클릭하여 시작"
          className="fixed inset-0 z-40 cursor-pointer focus:outline-none"
          onClick={startFromGate}
        />
      )}
      {intro && !introPlayed && (
        <div
          ref={promptRef}
          className="pointer-events-none fixed inset-x-0 top-[calc(50%+72px)] z-40 text-center"
          style={{ opacity: 0 }}
        >
          <span className="animate-pulse text-md font-bold tracking-[0.2em] text-chromedim">클릭하여 시작</span>
        </div>
      )}

      {/* 로딩 커튼 — 배경이 살짝 비치는 반투명 + 도형 애니메이션. 봇 소환은 취소 가능 */}
      <LoadingOverlay open={loading} message={loadingMsg} onCancel={cancellable ? () => goView("menu") : undefined} />

      {/* 우하단: 사운드 텍스트 토글 + 오프라인(?local) 모드 ↔ 기본 모드 전환 */}
      <div ref={cornerRef} className="fixed bottom-3 right-4 z-10 flex items-center gap-4" style={intro ? { opacity: 0 } : undefined}>
        <SoundToggles />
        <a href={isLocal ? "/" : "/?local"} className="text-xs text-chromedim/70 transition hover:text-white">
          {isLocal ? "기본 모드로 돌아가기" : "로컬 모드로 전환"}
        </a>
      </div>

      {/* 진행 중이던 인터넷 대전 재접속 안내 — 메시지 창으로 (?local 모드에서는 숨김) */}
      {canRejoin && introPlayed && !isLocal && !rejoinDismissed && !loading && view === "menu" && (
        <ConfirmDialog
          icon="🔁"
          message="진행 중인 인터넷 대전이 있습니다. 재접속할까요?"
          confirmLabel="재접속"
          cancelLabel="나중에"
          confirmClass="bg-emerald-600 hover:bg-emerald-700"
          onConfirm={() => {
            setRejoinDismissed(true);
            void doRejoin();
          }}
          onCancel={() => setRejoinDismissed(true)}
        />
      )}
</div>
    </main>
  );
}
