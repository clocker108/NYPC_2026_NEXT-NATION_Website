# public/sounds/ 라이선스

사용자 제공 표기가 없는 파일은 전부 **CC0 1.0 (퍼블릭 도메인)** 원본을 mp3로 변환한 것입니다. 표기 의무는 없으나 출처를 기록합니다.

## 효과음 — Kenney (kenney.nl, CC0)

| 파일 | 원본 | 팩 |
|---|---|---|
| ui-hover.mp3 | Audio/tick_001.ogg | [interface-sounds](https://kenney.nl/assets/interface-sounds) |
| ui-click.mp3 | Audio/click_003.ogg | [interface-sounds](https://kenney.nl/assets/interface-sounds) |
| menu-click.mp3 | Audio/drop_001.ogg | [interface-sounds](https://kenney.nl/assets/interface-sounds) |
| map-click.mp3 | Audio/impactGeneric_light_001.ogg | [impact-sounds](https://kenney.nl/assets/impact-sounds) |
| game-start.mp3 | Audio/confirmation_002.ogg | [interface-sounds](https://kenney.nl/assets/interface-sounds) |
| build.mp3 | Audio/impactPlank_medium_000.ogg | [impact-sounds](https://kenney.nl/assets/impact-sounds) |
| upgrade.mp3 | Audio/powerUp7.ogg | [digital-audio](https://kenney.nl/assets/digital-audio) |
| destroy.mp3 | Audio/explosionCrunch_000.ogg | [sci-fi-sounds](https://kenney.nl/assets/sci-fi-sounds) |
| move.mp3 | Audio/cloth2.ogg | [rpg-audio](https://kenney.nl/assets/rpg-audio) |
| combat.mp3 | Audio/impactMetal_medium_000.ogg | [impact-sounds](https://kenney.nl/assets/impact-sounds) |
| game-end.mp3 | Audio/Pizzicato jingles/jingles_PIZZI01.ogg | [music-jingles](https://kenney.nl/assets/music-jingles) |
| warn-time.mp3 | Audio/tone1.ogg | [digital-audio](https://kenney.nl/assets/digital-audio) |

## BGM — OpenGameArt (CC0)

| 파일 | 곡 | 작곡 | 출처 |
|---|---|---|---|
| bgm-game.mp3 | Galactic Temple | yd | https://opengameart.org/content/galactic-temple |
| bgm-wait.mp3 | Loading Screen Loop | HaelDB | https://opengameart.org/content/loading-screen-loop |

## 사용자 제공 (CC0 아님 — 배포 권리는 소유자 책임)

- bgm-menu.mp3 — 사용자 제공 메뉴 BGM: 2026-07-12 사용자 전달 mp3 — 무음 꼬리 3.7s 트림 + 평균 -24dB 정규화 + 192k 재인코딩만 적용

재생성: `npm run sounds:fetch` (ffmpeg-static으로 변환, 러프 라우드니스 정규화 포함)
