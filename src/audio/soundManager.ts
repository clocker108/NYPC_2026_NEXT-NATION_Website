// 사운드 재생 싱글턴 — React 밖(모듈 스코프)에 살고, 컴포넌트는 이벤트만 흘려보낸다.
// SFX = WebAudio 버퍼(겹침 재생·저지연), BGM = HTMLAudioElement 루프(스트리밍) + 볼륨 램프 크로스페이드.
// 브라우저 자동재생 정책: 첫 사용자 제스처에서 unlock되며, 그 전의 BGM 요청은 pending으로 보관.

import {
  BGM_FILES,
  BGM_GAIN,
  SFX_FILES,
  SFX_GAIN,
  effectiveBgmTrack,
  shouldPlaySfx,
  type BgmTrack,
  type SfxId,
} from "./sounds";
import { useSoundStore } from "@/store/soundStore";

const FADE_MS = 400;

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
const buffers = new Map<SfxId, AudioBuffer>();
const loading = new Set<SfxId>();
const lastPlayed = new Map<SfxId, number>();

const bgmEls = new Map<BgmTrack, HTMLAudioElement>();
let currentBgm: BgmTrack | null = null; // 실제로 흘러야 한다고 판단된 트랙 (null = 무음)
let screenTrack: "menu" | "game" = "menu";
let waitLoopOn = false;
let gameOver = false; // 승패 확정 — 게임 화면이어도 메뉴 BGM
let unlocked = false;
let initialized = false;
const fadeTimers = new Map<HTMLAudioElement, number>();

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_GAIN;
    sfxGain.connect(ctx.destination);
  }
  return ctx;
}

async function loadBuffer(id: SfxId) {
  const c = ensureCtx();
  if (!c || buffers.has(id) || loading.has(id)) return;
  loading.add(id);
  try {
    const res = await fetch(SFX_FILES[id]);
    if (!res.ok) return;
    const buf = await c.decodeAudioData(await res.arrayBuffer());
    buffers.set(id, buf);
  } catch {
    // 파일 없음/디코드 실패 — 무음으로 무시 (에셋 준비 전 dev에서도 앱은 정상 동작)
  } finally {
    loading.delete(id);
  }
}

function bgmEl(track: BgmTrack): HTMLAudioElement {
  let el = bgmEls.get(track);
  if (!el) {
    el = new Audio(BGM_FILES[track]);
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    el.dataset.bgm = track; // 검증용 마커 — DOM에 붙여야 E2E에서 조회 가능
    el.style.display = "none";
    document.body.appendChild(el);
    bgmEls.set(track, el);
  }
  return el;
}

/** 볼륨 램프 — rAF 대신 interval(백그라운드 탭에서도 진행) */
function fadeTo(el: HTMLAudioElement, target: number, onDone?: () => void) {
  const prev = fadeTimers.get(el);
  if (prev !== undefined) clearInterval(prev);
  const start = el.volume;
  const t0 = performance.now();
  const iv = window.setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    el.volume = start + (target - start) * k;
    if (k >= 1) {
      clearInterval(iv);
      fadeTimers.delete(el);
      onDone?.();
    }
  }, 40);
  fadeTimers.set(el, iv);
}

/** 스토어 + 내부 상태로부터 유효 트랙을 다시 계산해 반영 (멱등) */
function applyBgm() {
  if (typeof window === "undefined") return;
  const { bgmOn } = useSoundStore.getState();
  const want = effectiveBgmTrack(screenTrack, waitLoopOn, bgmOn, gameOver);
  if (want === currentBgm) return;
  const prevTrack = currentBgm;
  currentBgm = want;
  if (prevTrack) {
    const prev = bgmEls.get(prevTrack);
    if (prev) fadeTo(prev, 0, () => prev.pause());
  }
  if (want && !document.hidden) {
    const el = bgmEl(want);
    el.play().catch(() => {
      // 자동재생 거부 — unlock 시 applyBgm 재실행으로 재시도 (currentBgm은 want로 이미 기록)
    });
    fadeTo(el, BGM_GAIN);
  }
}

/** 탭 전환: 숨김 → 전부 무음(BGM pause + ctx suspend), 복귀 → 현재 트랙 재개 */
function onVisibility() {
  if (document.hidden) {
    ctx?.suspend().catch(() => {});
    for (const el of bgmEls.values()) {
      const t = fadeTimers.get(el);
      if (t !== undefined) {
        clearInterval(t);
        fadeTimers.delete(el);
      }
      if (!el.paused) el.pause();
    }
  } else {
    if (unlocked) ctx?.resume().catch(() => {});
    if (currentBgm) {
      const el = bgmEl(currentBgm);
      el.play().catch(() => {});
      fadeTo(el, BGM_GAIN);
    }
  }
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  ensureCtx()?.resume().catch(() => {});
  // 첫 제스처 전 거부된 BGM 재시도
  if (currentBgm) {
    const el = bgmEl(currentBgm);
    if (el.paused) {
      el.play().catch(() => {});
      fadeTo(el, BGM_GAIN);
    }
  }
}

export const soundManager = {
  /** 1회 초기화 — 제스처 unlock 리스너 + 설정 구독 + SFX 프리로드 */
  init() {
    if (initialized || typeof window === "undefined") return;
    initialized = true;
    const onGesture = () => {
      unlock();
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);

    document.addEventListener("visibilitychange", onVisibility);
    useSoundStore.subscribe(() => applyBgm());
    applyBgm();

    const preload = () => (Object.keys(SFX_FILES) as SfxId[]).forEach((id) => void loadBuffer(id));
    if ("requestIdleCallback" in window) window.requestIdleCallback(preload);
    else setTimeout(preload, 1000);
  },

  play(id: SfxId) {
    if (typeof document !== "undefined" && document.hidden) return; // 백그라운드 탭은 무음
    const c = ensureCtx();
    if (!c || !sfxGain) return;
    if (!useSoundStore.getState().sfxOn) return;
    const now = performance.now();
    if (!shouldPlaySfx(lastPlayed.get(id), now)) return;
    const buf = buffers.get(id);
    if (!buf) {
      // 프리로드 전 첫 재생(예: 시작 게이트 클릭) — 로드 완료 직후 재생 (로컬 수십 ms 지연)
      void loadBuffer(id).then(() => {
        const b = buffers.get(id);
        if (!b || !ctx || !sfxGain || document.hidden) return;
        lastPlayed.set(id, performance.now());
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(sfxGain);
        s.start();
      });
      return;
    }
    lastPlayed.set(id, now);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(sfxGain);
    src.start();
  },

  setScreenTrack(track: "menu" | "game") {
    screenTrack = track;
    applyBgm();
  },

  setWaitLoop(on: boolean) {
    waitLoopOn = on;
    applyBgm();
  },

  setGameOver(on: boolean) {
    gameOver = on;
    applyBgm();
  },
};
