"use client";

// 게임 규칙 오버레이 — 시작 화면·게임 화면 양쪽에서 공유하는 읽기 전용 설명서.
// ConfirmDialog의 오버레이/퇴장 패턴을 그대로 따르되, 스크롤 본문 + 2탭(빠른 시작·상세 규칙).
// 수치는 엔진 상수를 직접 렌더해 규칙과 코드가 어긋나지 않게 한다.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate } from "animejs";
import {
  START_GOLD,
  START_WARRIORS,
  TRAIN_COST,
  MOVE_COST,
  BASE_BUILD_COST,
  WORK_INCOME,
  UPKEEP_PER,
  MAX_DAYS,
  HQ_HEAL_COST,
  BASE_HEAL_COST,
  HQ_LEVELS,
  BASE_LEVELS,
  GEN_L,
  GEN_D,
  GEN_A,
} from "@/engine/constants";

// 본부 레벨1 초기값 (개요의 "본부 체력·전사 초기 체력"에 사용)
const HQ_START_HP = HQ_LEVELS[1].hp;
const WARRIOR_START_HP = HQ_LEVELS[1].warriorHp;

type Tab = "quick" | "detail";

// 강조 토큰 — 진영색/골드/수입으로 눈에 띄게
const G = ({ children }: { children: React.ReactNode }) => <b className="text-ngold">{children}</b>;
const A = () => <b className="text-nred">A(빨강)</b>;
const B = () => <b className="text-nblue">B(파랑)</b>;

// n을 주면(상세 규칙) 위에 구분선 + 번호 칩을 붙여 섹션을 또렷이 나눈다.
function Section({ title, n, children }: { title: string; n?: number; children: React.ReactNode }) {
  return (
    <section
      className={
        n !== undefined ? "mt-5 border-t border-chromeline pt-5 first:mt-0 first:border-t-0 first:pt-0" : "mt-5 first:mt-0"
      }
    >
      <h3 className="mb-2 flex items-center gap-2 text-[15px] font-bold tracking-wide text-white">
        {n !== undefined && (
          <span className="grid h-5 w-5 place-items-center rounded bg-ngold/15 text-[12px] font-bold text-ngold">{n}</span>
        )}
        {title}
      </h3>
      <div className="space-y-2 text-[13.5px] leading-relaxed text-chromedim">{children}</div>
    </section>
  );
}

function QuickTab() {
  return (
    <>
      <Section title="🎯 목표">
        <p>
          <G>{MAX_DAYS}일</G> 안에 상대의 <b className="text-white">본부(HQ)</b>를 파괴하면 승리합니다. 아무도
          파괴하지 못하면 본부 체력이 더 높은 쪽이 이깁니다.
        </p>
      </Section>
      <Section title="🗺️ 화면 보는 법">
        <p>
          맵은 여러 <b className="text-white">구역</b>이 선으로 연결된 그래프입니다. 내 <b className="text-white">본부</b>는
          한쪽 끝에 있고, 노란색 <b className="text-white">거점</b> 칸에는 기지를 지을 수 있습니다. <A /> 는 왼쪽,{" "}
          <B /> 는 오른쪽에서 시작합니다.
        </p>
      </Section>
      <Section title="🎮 매 턴 할 수 있는 일">
        <p>
          · <b className="text-white">이동</b> — 내 전사를 이웃 경로를 따라 목적지로 보냅니다. 한 번에 한 칸씩 전진하며,
          명령 1건에 <G>{MOVE_COST}골드</G>(아군 건물로 가면 무료).
        </p>
        <p>
          · <b className="text-white">훈련</b> — 본부에서 전사를 생산합니다. 1명당 <G>{TRAIN_COST}골드</G>, 본부 레벨만큼
          한 번에 뽑을 수 있습니다.
        </p>
        <p>
          · <b className="text-white">건설·업그레이드</b> — 거점에 기지를 짓거나(<G>{BASE_BUILD_COST}골드</G>) 건물을
          레벨업해 체력·방어·수입을 키웁니다.
        </p>
      </Section>
      <Section title="💰 경제">
        <p>
          시작 골드는 <G>{START_GOLD}</G>, 전사 <G>{START_WARRIORS}명</G>으로 출발합니다. 수입은 건물에서 일하는 전사
          1명당 <b className="text-nincome">{WORK_INCOME}골드</b>. 매일 저녁 전사 1명당 <b className="text-white">{UPKEEP_PER}골드</b>의
          유지비가 나가고, <b className="text-white">골드가 모자라면 전사가 굶어 체력이 깎입니다.</b> 체력이 다한 전사는 퇴각합니다.
        </p>
      </Section>
      <Section title="⚔️ 전투와 공성">
        <p>
          같은 구역에 양쪽 전사가 있으면 <b className="text-white">자동으로 교전</b>합니다. 수가 많은 쪽이 유리합니다.
          상대 전사를 모두 물리치고도 공격이 남으면, 그 공격이 구역의 <b className="text-white">건물을 때립니다.</b>
        </p>
      </Section>
    </>
  );
}

function LevelTables() {
  const hq = HQ_LEVELS.map((e, lvl) => ({ ...e, lvl })).filter((e) => e.lvl >= 1);
  const base = BASE_LEVELS.map((e, lvl) => ({ ...e, lvl })).filter((e) => e.lvl >= 1);
  const th = "px-2 py-1 text-left font-bold text-white";
  const td = "px-2 py-1 tabular-nums";
  return (
    <div className="mt-2 space-y-3">
      <div>
        <p className="mb-1 text-[12px] font-bold text-nred">본부 — 각 플레이어당 하나, 처음엔 레벨 1</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px] text-chromedim">
            <thead>
              <tr className="border-b border-chromeline">
                <th className={th}>레벨</th>
                <th className={th}>업그레이드 비용</th>
                <th className={th}>전사 최대 체력</th>
                <th className={th}>본부 최대 체력</th>
                <th className={th}>포탑 공격력</th>
                <th className={th}>훈련 가능</th>
                <th className={th}>노동 가능</th>
              </tr>
            </thead>
            <tbody>
              {hq.map((e) => (
                <tr key={e.lvl} className="border-b border-chromeline/40">
                  <td className={`${td} font-bold text-white`}>{e.lvl}</td>
                  <td className={td}>{e.lvl === 1 ? "-" : `금화 ${e.upgradeCost}`}</td>
                  <td className={td}>{e.warriorHp}</td>
                  <td className={td}>{e.hp}</td>
                  <td className={td}>{e.turret}</td>
                  <td className={td}>{e.trainCap}</td>
                  <td className={td}>{e.workCap}</td>
                </tr>
              ))}
              <tr className="border-b border-chromeline/40">
                <td className={`${td} font-bold text-white`}>{HQ_LEVELS.length - 1}+ (수리)</td>
                <td className={td}>금화 {HQ_HEAL_COST}</td>
                <td className={td}>-</td>
                <td className={td}>-</td>
                <td className={td}>-</td>
                <td className={td}>-</td>
                <td className={td}>-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[12px] font-bold text-nblue">기지 — 거점에 원하는 만큼 건설, 훈련 불가</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px] text-chromedim">
            <thead>
              <tr className="border-b border-chromeline">
                <th className={th}>레벨</th>
                <th className={th}>건설·업그레이드 비용</th>
                <th className={th}>최대 체력</th>
                <th className={th}>포탑 공격력</th>
                <th className={th}>노동 가능</th>
              </tr>
            </thead>
            <tbody>
              {base.map((e) => (
                <tr key={e.lvl} className="border-b border-chromeline/40">
                  <td className={`${td} font-bold text-white`}>{e.lvl}</td>
                  <td className={td}>금화 {e.cost}</td>
                  <td className={td}>{e.hp}</td>
                  <td className={td}>{e.turret}</td>
                  <td className={td}>{e.workCap}</td>
                </tr>
              ))}
              <tr className="border-b border-chromeline/40">
                <td className={`${td} font-bold text-white`}>{BASE_LEVELS.length - 1}+ (수리)</td>
                <td className={td}>금화 {BASE_HEAL_COST}</td>
                <td className={td}>-</td>
                <td className={td}>-</td>
                <td className={td}>-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const VIDEO_ID = "BnExruRtP1A";

// 규칙 설명 영상 — 이 앱은 COEP: require-corp(Pyodide SAB용)라 일반 교차출처 iframe이 차단된다.
// iframe의 credentialless 속성이 있으면 require-corp에서도 로드됨(Chromium). 속성이 있어야 src 로드
// 전에 붙으므로 imperative로 생성한다. 미지원(FF/Safari)이면 새 창 링크로 대체.
function RulesVideo() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(typeof HTMLIFrameElement !== "undefined" && "credentialless" in HTMLIFrameElement.prototype);
  }, []);

  useEffect(() => {
    if (supported !== true || !boxRef.current) return;
    const f = document.createElement("iframe");
    f.setAttribute("credentialless", ""); // src 지정 전에 먼저 — 그래야 require-corp에서 차단 안 됨
    f.title = "NEXT NATION 규칙 영상";
    f.className = "h-full w-full";
    f.allow = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";
    f.allowFullscreen = true;
    f.src = `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`;
    boxRef.current.appendChild(f);
    return () => f.remove();
  }, [supported]);

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-chromeline bg-black">
      <div ref={boxRef} className="relative aspect-video w-full">
        {/* credentialless 미지원(FF/Safari) — 로컬 썸네일(같은 출처라 COEP 무관) 카드로 새 창 재생 */}
        {supported === false && (
          <a
            href={`https://www.youtube.com/watch?v=${VIDEO_ID}`}
            target="_blank"
            rel="noreferrer"
            className="group absolute inset-0 block"
            aria-label="규칙 설명 영상 보기 (새 창)"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/rules-video-thumb.jpg"
              alt="규칙 설명 영상 썸네일"
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <span className="absolute inset-0 grid place-items-center bg-black/35 transition group-hover:bg-black/20">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-black/75 pl-1 text-2xl text-white shadow-lg transition group-hover:scale-110">
                ▶
              </span>
            </span>
            <span className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-[12px] text-white/90">
              규칙 설명 영상
              <span className="rounded bg-white/15 px-1.5 py-0.5 text-[11px]">YouTube에서 보기 ↗</span>
            </span>
          </a>
        )}
      </div>
    </div>
  );
}

// 소제목(본부·기지·아침 등) — 굵은 흰색 + 앞의 금빛 틱으로 본문과 구분
function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-0.5 mt-3 flex items-center gap-1.5 font-bold text-white">
      <span className="inline-block h-3.5 w-1 rounded-full bg-ngold/70" />
      {children}
    </p>
  );
}

// 상세 규칙 — NYPC 대회 문제 원문(NEXT NATION)을 최대한 그대로 옮김. 수치는 엔진 상수에서.
function DetailTab() {
  return (
    <>
      <RulesVideo />
      <Section n={1} title="개요">
        <p>
          게임은 <b className="text-white">전장</b> 위에서 진행됩니다. 전장은 0번부터 N−1번까지 번호가 붙은 N개의{" "}
          <b className="text-white">구역</b>으로 나뉘어 있으며, 중심을 기준으로 점대칭을 이룹니다. 가장 왼쪽(0번)과 오른쪽(N−1번)
          구역에는 각 플레이어의 <b className="text-white">본부</b>가 있습니다. 본부가 없는 구역 중 K개는{" "}
          <b className="text-white">기지</b>를 건설 가능한 <b className="text-white">거점</b>입니다.
        </p>
        <p>
          전장의 크기 N은 <G>51 ≤ N ≤ 109</G>, 거점의 수 K는 <G>올림(0.15N) ≤ K ≤ 내림(0.2N)</G>입니다. N과 K는 반드시
          홀수입니다.
        </p>
        <p>
          각 플레이어는 본부에 위치한 전사 <G>{START_WARRIORS}명</G>과 금화 <G>{START_GOLD}개</G>로 시작합니다. 본부는 초기에
          레벨 1, 체력 {HQ_START_HP}이며, 전사의 초기 체력은 {WARRIOR_START_HP}입니다.{" "}
          <b className="text-white">본부가 파괴된 플레이어는 패배합니다.</b>
        </p>

        <Sub>매일 플레이어는 다음 명령을 내릴 수 있습니다</Sub>
        <p className="mt-2">
          · <b className="text-white">건설</b> — 이미 있는 아군 건물(본부·기지)을 업그레이드하거나, 건물이 없는 거점 위에 새
          기지를 건설합니다. 명령을 수행할 위치에는 아군 전사가 한 명 이상 있고, 적 전사가 없어야 합니다.
        </p>
        <p>
          · <b className="text-white">이동</b> — 현재 이동 상태가 아닌 전사 하나에게 특정 구역으로 이동하라고 명령합니다.
        </p>
        <p>
          · <b className="text-white">훈련</b> — 본부에서 전사를 n명 훈련합니다. n은 본부의 훈련 가능 전사 수 이하인 0 이상의
          정수여야 하며, 훈련 명령은 하루에 한 번을 초과할 수 없습니다.
        </p>

        <Sub>하루의 진행 — 아침 · 낮 · 저녁</Sub>
        <p className="mt-2">
          <b className="text-white">아침</b>은 건설 단계 → 이동 단계 → 훈련 단계 순으로 진행됩니다.
        </p>
        <p>· 건설 단계: 금화를 지불하고 새 기지를 건설하거나 기존 건물을 업그레이드합니다.</p>
        <p>
          · 이동 단계: 오늘 이동 명령을 받았거나 이동 중이던 전사들이 이동 규칙에 따라 최대 한 칸 이동합니다. 이동 명령을 새로
          받은 전사마다 금화 <G>{MOVE_COST}개</G>를 지불합니다. 단, 목적지가 아군 건물이라면 지불하지 않습니다.
        </p>
        <p>
          · 훈련 단계: 훈련하기로 한 전사 수만큼 본부에서 전사를 훈련하고 한 명당 금화 <G>{TRAIN_COST}개</G>를 지불합니다.
          훈련된 전사의 체력은 본부의 레벨에 따릅니다. 전사는 훈련되면 고유한 번호를 받으며, 먼저 훈련된 전사가 더 작은 번호를
          가집니다.
        </p>
        <p>
          <b className="text-white">낮</b>에는 전투 단계가 진행됩니다. 전투 규칙에 따라 적 전사와 건물을 공격합니다.
        </p>
        <p>
          <b className="text-white">저녁</b>은 노동 단계 → 보급 단계 순으로 진행됩니다.
        </p>
        <p>
          · 노동 단계: 각 건물에서 <b className="text-nincome">{WORK_INCOME}×x</b>만큼 금화를 얻습니다. x는 해당 구역의 아군
          전사 수와 해당 건물의 노동 가능 전사 수 중 작은 값입니다.
        </p>
        <p>
          · 보급 단계: 번호 오름차순으로 각 전사가 <G>{UPKEEP_PER}</G>만큼의 금화를 식비로 소모합니다. 식비가 부족하면 그 전사는
          체력을 1 잃고, 체력이 0이 된 전사는 퇴각하여 전장에서 벗어납니다.
        </p>
      </Section>

      <Section n={2} title="건물">
        <p>건물은 수입을 책임지는 원천입니다. 건물은 업그레이드 또는 수리 시 체력이 최대 체력까지 가득 찹니다.</p>
        <p>
          건물에는 포탑이 있어, 매일 전투 단계 시작 시 공격력만큼 같은 구역에 공격을 수행합니다. 각 구역에 대해 건설 명령은 하루에
          최대 한 번만 내릴 수 있습니다 — 한 건물을 하루에 두 번 이상 업그레이드하거나, 오늘 새로 지은 건물을 오늘 업그레이드할 수
          없습니다.
        </p>
        <LevelTables />
      </Section>

      <Section n={3} title="이동과 전투">
        <Sub>이동 규칙</Sub>
        <p className="mt-2">
          이동 명령을 수행 중인 각 전사는 <b className="text-white">현재 구역에 적 전사가 없다면</b>, 현재 위치에서 목적지까지
          인접한 두 구역 사이의 직선 거리 합이 가장 짧은 경로를 따라 한 구역 이동합니다.
        </p>
        <p>
          두 구역 간의 <b className="text-white">직선 거리</b>는 두 구역 중심 사이 유클리드 거리(직선 거리)를 올림한 정수값입니다.
          최소가 되는 경로가 여럿이라면 <b className="text-white">구역 번호가 더 작은</b> 구역으로 이동합니다.
        </p>
        <p>
          이동 명령을 한 번 내리면 해당 전사는 목적지에 도착할 때까지 다른 이동 명령을 받을 수 없고, 도착하는 즉시 명령이
          끝납니다. 금화를 소모한 이동 후 목적지에 기지가 지어져도 금화는 반환되지 않으며, 금화를 소모하지 않은 이동 후 목적지 건물이
          파괴되어도 이동은 중단되지 않습니다.
        </p>
        <Sub>전투 규칙</Sub>
        <p className="mt-2">건물이 있는 구역에서, 해당 건물은 포탑 공격력 횟수만큼 공격을 수행합니다.</p>
        <p>
          각 구역에서 나와 상대 전사 수가 각각 a, b라 할 때, <b className="text-white">상대는 a번, 나는 b번 공격당합니다</b>. 체력이
          0인 전사는 전투가 끝날 때까지 퇴각하지 않으므로, 포탑 공격으로 체력이 0이 된 전사도 a와 b에 포함됩니다.
        </p>
        <p>매 공격은 다음을 따릅니다.</p>
        <p>
          · 그 구역에서 체력이 0이 아닌 상대편 전사 중 <b className="text-white">체력이 가장 작은</b> 전사의 체력이 1 감소합니다.
          그러한 전사가 여럿이면 번호가 가장 앞선 전사가 대상입니다.
        </p>
        <p>
          · 체력이 0이 아닌 상대편 전사가 없고 체력이 0이 아닌 상대편 건물이 있다면, 해당 건물의 체력이 1 감소합니다.
        </p>
        <p>전투가 종료되면 체력 0인 전사가 퇴각하고, 체력 0인 건물이 파괴됩니다.</p>
      </Section>

      <Section n={4} title="게임 종료">
        <p>
          게임이 시작하고 <G>{MAX_DAYS}일</G> 동안 어느 한 플레이어의 본부가 파괴되었다면, 파괴되지 않은 플레이어가 승리합니다.
        </p>
        <p>
          두 본부가 동시에 파괴된 경우, 또는 {MAX_DAYS}일 동안 양쪽 본부가 모두 파괴되지 않은 경우에는{" "}
          <b className="text-white">본부의 체력이 더 많은 쪽</b>이 승리합니다. 본부의 체력도 같다면 무승부입니다.
        </p>
      </Section>
    </>
  );
}

export default function RulesOverlay({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [tab, setTab] = useState<Tab>("quick");

  // 탭 전환 애니메이션 — 내용은 방향성 슬라이드, 밑줄 바는 활성 탭으로 부드럽게 이동
  const headerRef = useRef<HTMLDivElement>(null); // 밑줄의 offsetParent(구분선 위에 정렬)
  const quickBtnRef = useRef<HTMLButtonElement>(null);
  const detailBtnRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null); // 내용 슬라이드 래퍼
  const scrollRef = useRef<HTMLDivElement>(null); // 전환 시 스크롤 top 리셋
  const animatingRef = useRef(false);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });

  // 밑줄 바 위치·너비를 활성 탭 버튼에 맞춤 (offsetLeft는 headerRef 기준 — 헤더 바닥=구분선에 정렬)
  useLayoutEffect(() => {
    const btn = tab === "quick" ? quickBtnRef.current : detailBtnRef.current;
    if (btn) setUnderline({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [tab]);

  const TAB_ORDER: Tab[] = ["quick", "detail"];
  const switchTab = (next: Tab) => {
    if (next === tab || animatingRef.current) return;
    const el = bodyRef.current;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || rm) {
      setTab(next);
      return;
    }
    // 앞으로(빠른→상세) 넘어가면 dir=+1: 나가는 내용은 왼쪽으로, 들어오는 내용은 오른쪽에서 왼쪽으로
    const dir = TAB_ORDER.indexOf(next) > TAB_ORDER.indexOf(tab) ? 1 : -1;
    animatingRef.current = true;
    animate(el, {
      translateX: -dir * 28,
      opacity: 0,
      duration: 120,
      ease: "inQuad",
      onComplete: () => {
        setTab(next);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        // 새 내용이 DOM에 반영된 다음 프레임에 반대편에서 슬라이드 인 (플래시 없음)
        requestAnimationFrame(() => {
          const el2 = bodyRef.current;
          if (!el2) {
            animatingRef.current = false;
            return;
          }
          el2.style.opacity = "0";
          el2.style.transform = `translateX(${dir * 28}px)`;
          animate(el2, {
            translateX: 0,
            opacity: 1,
            duration: 190,
            ease: "outQuad",
            onComplete: () => {
              animatingRef.current = false;
              el2.style.transform = "";
            },
          });
        });
      },
    });
  };

  // 퇴장 애니메이션 후 닫기 — ConfirmDialog와 동일(중복 가드 + 보증 타이머)
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
    if (cardRef.current) animate(cardRef.current, { translateY: -8, scale: 0.97, duration: 180, ease: "outQuad" });
    setTimeout(fire, 280);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabCls = (t: Tab) =>
    `cursor-pointer px-3 py-1.5 text-sm font-bold transition ${tab === t ? "text-white" : "text-chromedim hover:text-white"}`;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        ref={cardRef}
        className="dropdown-enter flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-chromeline bg-chrome shadow-2xl"
        role="dialog"
        aria-modal
        aria-label="게임 규칙"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더: 탭 + 닫기 (relative — 밑줄 바의 offsetParent) */}
        <div ref={headerRef} className="relative flex items-center gap-3 border-b border-chromeline px-5 pt-4">
          <div className="flex flex-1">
            <button ref={quickBtnRef} data-sfx="ui-click" className={tabCls("quick")} onClick={() => switchTab("quick")}>
              게임 목표
            </button>
            <button ref={detailBtnRef} data-sfx="ui-click" className={tabCls("detail")} onClick={() => switchTab("detail")}>
              상세 규칙
            </button>
          </div>
          <button
            data-sfx="ui-click"
            className="mb-3 grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-chromeline bg-chrome2 text-chromedim hover:text-white"
            title="닫기"
            aria-label="닫기"
            onClick={close}
          >
            ✕
          </button>
          {/* 활성 탭 밑줄 — 헤더 바닥(구분선 위)에 놓고 left/width를 CSS transition으로 슬라이드 */}
          <span
            className="pointer-events-none absolute bottom-0 h-0.5 rounded bg-ngold transition-all duration-200 ease-out"
            style={{ left: underline.left, width: underline.width }}
          />
        </div>

        {/* 본문 (스크롤) — 탭 내용은 bodyRef 래퍼가 방향성 슬라이드 */}
        <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
          <div ref={bodyRef}>{tab === "quick" ? <QuickTab /> : <DetailTab />}</div>
        </div>
      </div>
    </div>
  );
}
