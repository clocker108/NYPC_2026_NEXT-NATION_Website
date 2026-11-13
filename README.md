# NEXT NATION — 웹 플레이어

NYPC 대회 게임 "NEXT NATION"(2인 동시턴 그래프 전략)을 브라우저에서 직접 플레이하고,
대전 로그를 리플레이로 분석할 수 있는 웹 앱입니다.

## 실행

```bash
npm install
npm run dev        # http://localhost:3000
npm run worker:dev # (선택) 인터넷 대전 서버 — http://localhost:8787
```

- **봇 실행**: "인공지능 대전"은 기본적으로 브라우저-내 Python(Pyodide, WASM)으로
  봇을 돌리게 됩니다. 로컬 `pypy3` 서버 브리지는 SharedArrayBuffer 미지원 브라우저 폴백과
  E2E 테스트(`tests/bridgeE2e.test.ts`)에만 쓰입니다.
- **인터넷 대전**은 별도 Cloudflare Worker가 필요합니다(`worker/`)! 서버가 없으면 앱은 자동으로
  오프라인 모드(`?local` — 인터넷 대전만 비활성)로 재시작됩니다.
- 테스트: `npm test` (vitest — 엔진 충실도 픽스처 9개 + 유닛/플로우/AI 스모크/사운드/온라인/브리지·Pyodide E2E)

## 모드

| 모드 | 설명 |
|---|---|
| **로컬 대전 (2인)** | A가 명령 계획·제출 -> 화면 커튼으로 교대 -> B 계획·제출 -> 동시 해소 |
| **인공지능 대전** | Python 봇과 대결: 기본 = 브라우저내 Pyodide |
| **인터넷 대전** | 6자리 방 번호로 친구와 실시간 대결 (WebSocket 락스텝, Cloudflare Worker + Durable Object) |
| **데모 대결 보기** | 번들된 데모 로그(`public/logs/`)를 턴별로 재생·분석 |

## 조작

- **맵**: 클릭=셀 선택, 드래그=이동, 휠=줌. 계획 중엔 내 셀 클릭 → 병력 수 지정 → 목적지 클릭
- **재생 바**: Space=재생/정지, <-/->=턴 이동, 속도 ×0.5~×16, 타임라인 빨간 틱=전투/공성 턴
- **분석 패널**(좌): 표시 옵션 + 추이 차트 7종 (차트 클릭으로 해당 턴 이동)
- **정보 패널**(우): 턴별 명령 내역, 셀 상세(호버/클릭)

## 구조

```
app/                    
  api/…                 세션 생성·턴 교환·종료 (pypy3 서브프로세스 파이프 — SAB 미지원 폴백)
src/
  engine/               게임 엔진 (순수 TS, 프레임워크 무관)
  bridge/               봇 백엔드 (기본=Pyodide, 폴백=서버 API) + 봇 프로토콜 직렬화
  online/               인터넷 대전 클라이언트 (프로토콜·WS 클라이언트·설정)
  audio/                사운드 시스템 (WebAudio SFX + BGM 크로스페이드)
  server/               봇 세션 매니저 (폴백 API Routes 공용)
  store/                zustand 전역 스토어 (히스토리가 스크러버·차트·헤더 구동)
  ui/                   화면 컴포넌트 (Tailwind CSS v4)
  ai/                   내장 JS AI (AI 스모크 테스트 전용 — UI 미노출)
worker/                 인터넷 대전 서버 (Cloudflare Worker + SQLite Durable Object)
tests/                  vitest + fixtures
server-bots/            브리지용 봇 실행 파일
public/                 pyodide 런타임·봇·사운드·데모 로그
```
