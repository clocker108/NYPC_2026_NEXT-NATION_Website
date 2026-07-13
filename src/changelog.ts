// 앱 버전 + 업데이트 내역 단일 소스.
// 우하단 버전 표기(APP_VERSION)와 "업데이트 내용" 창(UpdatesDialog)이 여기서 읽는다.
// 새 릴리스는 배열 맨 앞에 추가 — APP_VERSION은 항상 최신(0번) 항목을 가리킨다.

export interface ChangelogEntry {
  version: string;
  notes: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  { version: "v1.0.2-beta", notes: ["앱 버전 및 업데이트 내용 표시 기능 추가"] },
  { version: "v1.0.1-beta", notes: ["첫 턴에서 수입이 0으로 뜨는 버그 수정"] }
];

export const APP_VERSION = CHANGELOG[0].version;
