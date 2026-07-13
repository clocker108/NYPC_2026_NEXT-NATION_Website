// 렌더링용 Voronoi 셀 폴리곤 — 맵 좌표(실노드 + 가드점 24개)에서 계산하고
// 원판으로 클리핑해 공식 뷰어의 원형 맵 모양을 재현한다.

import { Delaunay } from "d3-delaunay";
import { GEN_L } from "./constants";
import type { MapData } from "./map";
import { guardPoints } from "./mapgen";

export type Polygon = [number, number][];

// 클리핑 원 반지름 — 노드 범위(10000)보다 살짝 크게 (공식 뷰어의 원판 느낌)
export const CLIP_RADIUS = 11000;

function circlePolygon(radius: number, segments = 96): Polygon {
  const poly: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const t = (i * 2 * Math.PI) / segments;
    poly.push([radius * Math.cos(t), radius * Math.sin(t)]);
  }
  return poly;
}

// Sutherland–Hodgman: 볼록 클리핑 다각형(반시계)에 대해 subject를 자른다
function clipPolygon(subject: Polygon, clip: Polygon): Polygon {
  let output = subject;
  const n = clip.length;
  for (let i = 0; i < n && output.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % n];
    const input = output;
    output = [];
    const inside = (p: [number, number]) =>
      (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const intersect = (p: [number, number], q: [number, number]): [number, number] => {
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const denom = dx * ey - dy * ex;
      const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / denom;
      return [p[0] + t * dx, p[1] + t * dy];
    };
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
    }
  }
  return output;
}

const polyCache = new WeakMap<MapData, Polygon[]>();

/** 각 지역의 Voronoi 셀 폴리곤 (지역 번호 인덱스). 캐시됨. */
export function computeCellPolygons(m: MapData): Polygon[] {
  const hit = polyCache.get(m);
  if (hit) return hit;

  const pts: [number, number][] = [];
  for (let i = 0; i < m.n; i++) pts.push([m.x[i], m.y[i]]);
  for (const g of guardPoints()) pts.push(g);

  const d = Delaunay.from(pts);
  const bound = 2 * GEN_L;
  const vor = d.voronoi([-bound, -bound, bound, bound]);
  const clip = circlePolygon(CLIP_RADIUS);

  const out: Polygon[] = [];
  for (let i = 0; i < m.n; i++) {
    const cell = vor.cellPolygon(i);
    if (!cell) {
      out.push([]);
      continue;
    }
    // d3는 마지막 점이 첫 점과 중복된 닫힌 폴리곤을 반환 — 중복 제거
    const poly = (cell as unknown as [number, number][]).slice(0, -1);
    out.push(clipPolygon(poly, clip));
  }
  polyCache.set(m, out);
  return out;
}
