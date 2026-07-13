// 맵 데이터 + 경로 계산 — testing-tool.py의 edge_weight/dijkstra/bfs를 그대로 포팅.

import type { Side } from "./types";

export interface MapData {
  n: number;
  k: number;
  x: number[];
  y: number[];
  strongholds: number[];
  adj: number[][]; // 각 행 오름차순 정렬 (엔진과 동일 — next-hop 동률 규칙의 전제)
}

export function hqRegion(m: MapData, side: Side): number {
  return side === 0 ? 0 : m.n - 1;
}

export function edgeWeight(m: MapData, u: number, v: number): number {
  const dx = m.x[u] - m.x[v];
  const dy = m.y[u] - m.y[v];
  return Math.ceil(Math.sqrt(dx * dx + dy * dy));
}

// 맵별 다익스트라 캐시 (target → dist[])
const dijkstraCache = new WeakMap<MapData, Map<number, number[]>>();

export function dijkstraFrom(m: MapData, target: number): number[] {
  let cache = dijkstraCache.get(m);
  if (!cache) {
    cache = new Map();
    dijkstraCache.set(m, cache);
  }
  const hit = cache.get(target);
  if (hit) return hit;

  const dist = new Array<number>(m.n).fill(-1);
  dist[target] = 0;
  // 단순 이진힙 (N≤109라 성능 무관하지만 정확한 다익스트라 유지)
  const heap: [number, number][] = [[0, target]];
  while (heap.length > 0) {
    // pop min
    let mi = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[mi][0]) mi = i;
    const [du, u] = heap.splice(mi, 1)[0];
    if (du !== dist[u]) continue;
    for (const v of m.adj[u]) {
      const dv = du + edgeWeight(m, u, v);
      if (dist[v] < 0 || dv < dist[v]) {
        dist[v] = dv;
        heap.push([dv, v]);
      }
    }
  }
  cache.set(target, dist);
  return dist;
}

export function bfsReachable(m: MapData, src: number, dst: number): boolean {
  if (src === dst) return true;
  const visited = new Array<boolean>(m.n).fill(false);
  const q = [src];
  visited[src] = true;
  for (let i = 0; i < q.length; i++) {
    for (const v of m.adj[q[i]]) {
      if (v === dst) return true;
      if (!visited[v]) {
        visited[v] = true;
        q.push(v);
      }
    }
  }
  return false;
}

// 다음 홉: edge_weight(cur,v) + dist[v] 최소, 동률 = 낮은 노드번호(adj 오름차순 + 엄격 <)
export function nextHop(m: MapData, cur: number, target: number): number {
  const dist = dijkstraFrom(m, target);
  let bestV = -1;
  let bestScore = -1;
  for (const v of m.adj[cur]) {
    if (dist[v] < 0) continue;
    const score = edgeWeight(m, cur, v) + dist[v];
    if (bestScore < 0 || score < bestScore) {
      bestScore = score;
      bestV = v;
    }
  }
  return bestV;
}

// 전체 경로 미리보기 (UI용): cur → target 홉 목록
export function pathPreview(m: MapData, from: number, target: number): number[] {
  const path = [from];
  let cur = from;
  let guard = 0;
  while (cur !== target && guard++ < m.n) {
    const nv = nextHop(m, cur, target);
    if (nv < 0) break;
    path.push(nv);
    cur = nv;
  }
  return path;
}
