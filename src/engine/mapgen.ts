// JS 자체 맵 생성기 — NYPC 규칙 §5의 절차를 따르되 Python 시드 호환은 불필요.
// (리플레이는 로그의 MAP 블록을 그대로 쓰므로, 생성기는 새 게임 전용)
// 불변식: 점대칭(x[i] = -x[N-1-i]), N·K 홀수, 거점 대칭쌍+중앙·비인접·HQ 제외.

import { Delaunay } from "d3-delaunay";
import { GEN_A, GEN_D, GEN_L } from "./constants";
import type { MapData } from "./map";

// mulberry32 — 시드 재현 가능한 경량 PRNG
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function guardPoints(): [number, number][] {
  const R = 1.5 * GEN_L;
  const pts: [number, number][] = [];
  for (let i = 0; i < GEN_A; i++) {
    const theta = (i * 2 * Math.PI) / GEN_A;
    pts.push([Math.trunc(R * Math.cos(theta)), Math.trunc(R * Math.sin(theta))]);
  }
  return pts;
}

function polygonCentroid(poly: ArrayLike<number>[] | [number, number][]): [number, number] {
  // shoelace 기반 다각형 무게중심
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i] as [number, number];
    const [x1, y1] = poly[(i + 1) % n] as [number, number];
    const cross = x0 * y1 - x1 * y0;
    a2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a2) < 1e-9) {
    // 퇴화 — 정점 평균으로 폴백
    let sx = 0, sy = 0;
    for (const [px, py] of poly as [number, number][]) {
      sx += px;
      sy += py;
    }
    return [sx / n, sy / n];
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

function tryGenerate(rng: () => number, NP: number, KP: number): MapData | null {
  const N = 2 * NP + 1;
  const K = 2 * KP + 1;
  const L = GEN_L;
  const D2 = GEN_D * GEN_D;

  // 1) 대칭 정수점 rejection sampling
  const pts: [number, number][] = [[0, 0]];
  let placed = 0;
  let attempts = 0;
  const maxAttempts = NP * 20000;
  while (placed < NP) {
    if (++attempts > maxAttempts) return null;
    const x = randInt(rng, -L, L);
    const y = randInt(rng, -L, L);
    if (x * x + y * y > L * L) continue;
    let ok = true;
    for (const [px, py] of pts) {
      if (px === x) {
        ok = false;
        break;
      }
      const dx = px - x;
      const dy = py - y;
      if (dx * dx + dy * dy < D2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pts.push([x, y], [-x, -y]);
    placed++;
  }

  // 2) x 오름차순 정렬 → 지역 번호 확정 (중앙 = NP)
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts[NP][0] !== 0 || pts[NP][1] !== 0) return null;

  const guards = guardPoints();

  // 3) Lloyd 완화 1회 (Voronoi 셀 무게중심으로 이동) — 좌반부만 계산 후 미러로 대칭 보장
  const all1: [number, number][] = [...pts, ...guards];
  const d1 = Delaunay.from(all1);
  const vor1 = d1.voronoi([-2 * L, -2 * L, 2 * L, 2 * L]);
  const relaxed: [number, number][] = new Array(N);
  relaxed[NP] = [0, 0];
  for (let i = 0; i < NP; i++) {
    const cell = vor1.cellPolygon(i);
    if (!cell) return null;
    const [cx, cy] = polygonCentroid(cell as unknown as [number, number][]);
    // + 0 으로 -0 정규화 (미러 좌표와의 정확한 대칭 보장)
    const rx = Math.round(cx) + 0 === 0 ? 0 : Math.round(cx);
    const ry = Math.round(cy) + 0 === 0 ? 0 : Math.round(cy);
    relaxed[i] = [rx, ry];
    relaxed[N - 1 - i] = [rx === 0 ? 0 : -rx, ry === 0 ? 0 : -ry];
  }
  // 주의: 완화 후 x는 비단조일 수 있음(실제 공식 맵도 동일) — 번호는 완화 전 정렬 순서로 고정.
  // 완화로 두 점이 같은 좌표로 붕괴하면 재시도.
  {
    const seenPts = new Set<string>();
    for (const [rx, ry] of relaxed) {
      const id = `${rx},${ry}`;
      if (seenPts.has(id)) return null;
      seenPts.add(id);
    }
  }

  // 4) 인접 = 완화점 기준 Delaunay 엣지 (실노드끼리만), 미러 대칭화
  const all2: [number, number][] = [...relaxed, ...guards];
  const d2 = Delaunay.from(all2);
  const adjSets: Set<number>[] = Array.from({ length: N }, () => new Set<number>());
  for (let i = 0; i < N; i++) {
    for (const j of d2.neighbors(i)) {
      if (j < N && j !== i) adjSets[i].add(j);
    }
  }
  // 점대칭 엣지 보장 (부동소수 동률로 깨질 수 있는 대칭을 강제)
  for (let u = 0; u < N; u++) {
    for (const v of [...adjSets[u]]) {
      adjSets[u].add(v);
      adjSets[v].add(u);
      adjSets[N - 1 - u].add(N - 1 - v);
      adjSets[N - 1 - v].add(N - 1 - u);
    }
  }
  const adj = adjSets.map((s) => [...s].sort((a, b) => a - b));

  // 연결성 확인
  {
    const seen = new Array<boolean>(N).fill(false);
    const q = [0];
    seen[0] = true;
    for (let qi = 0; qi < q.length; qi++) {
      for (const v of adj[q[qi]]) {
        if (!seen[v]) {
          seen[v] = true;
          q.push(v);
        }
      }
    }
    if (seen.some((s) => !s)) return null;
  }

  // 5) 거점 선택: 중앙 + 대칭쌍 KP개, 서로 비인접, HQ 제외
  const R = new Set<number>([NP]);
  const candidates: number[] = [];
  for (let c = 1; c < NP; c++) candidates.push(c);
  // Fisher–Yates
  for (let i = candidates.length - 1; i >= 1; i--) {
    const j = randInt(rng, 0, i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const c of candidates) {
    if (R.size >= K) break;
    const mir = N - 1 - c;
    if (R.has(c) || R.has(mir)) continue;
    let bad = false;
    for (const r of R) {
      if (adj[c].includes(r) || adj[mir].includes(r)) {
        bad = true;
        break;
      }
    }
    if (bad) continue;
    if (adj[c].includes(mir)) continue;
    R.add(c);
    R.add(mir);
  }
  if (R.size < K) return null;

  return {
    n: N,
    k: K,
    x: relaxed.map((p) => p[0]),
    y: relaxed.map((p) => p[1]),
    strongholds: [...R].sort((a, b) => a - b),
    adj,
  };
}

export interface GenerateOptions {
  seed?: number;
  np?: number; // N = 2*NP+1, NP∈[25,54]
  npRange?: [number, number]; // np 미지정 시 이 구간에서 시드 rng로 추첨 (기본 [25,54])
  kp?: number; // K = 2*KP+1 (N에 따른 유효범위 내)
}

export function kpRange(n: number): [number, number] {
  const kLo = Math.ceil(0.15 * n);
  const kHi = Math.floor(0.2 * n);
  const kLoOdd = kLo % 2 === 0 ? kLo + 1 : kLo;
  const kHiOdd = kHi % 2 === 0 ? kHi - 1 : kHi;
  return [(kLoOdd - 1) / 2, (kHiOdd - 1) / 2];
}

export function generateMap(opts: GenerateOptions = {}): MapData {
  const baseSeed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  // 생성 실패(퇴화/거점부족) 시 파생 시드로 재시도
  for (let retry = 0; retry < 50; retry++) {
    const rng = mulberry32(baseSeed + retry * 7919);
    const npLo = Math.max(25, opts.npRange?.[0] ?? 25);
    const npHi = Math.min(54, opts.npRange?.[1] ?? 54);
    const NP = opts.np ?? randInt(rng, npLo, Math.max(npLo, npHi));
    const N = 2 * NP + 1;
    const [kpLo, kpHi] = kpRange(N);
    let KP = opts.kp ?? randInt(rng, kpLo, kpHi);
    if (KP < kpLo) KP = kpLo;
    if (KP > kpHi) KP = kpHi;
    const m = tryGenerate(rng, NP, KP);
    if (m) return m;
  }
  throw new Error("map generation failed after retries");
}
