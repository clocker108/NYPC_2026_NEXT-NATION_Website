// CC0 사운드 에셋 파이프라인 — 다운로드 → 해제 → mp3 변환(러프 라우드니스 정규화) → LICENSES.md.
// 산출물(public/sounds/)은 커밋되므로 이 스크립트는 재생성용 1회성이다: `npm run sounds:fetch`
// 포맷은 MP3 단일 (Safari가 OGG Vorbis을 재생 못 함).

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import ffmpegPath from "ffmpeg-static";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "sounds");
const tmpDir = join(root, ".sounds-tmp");

/* ── Kenney 팩 (전부 CC0 — kenney.nl) ── */
const KENNEY_PACKS = {
  "interface-sounds": "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
  "ui-audio": "https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip",
  "impact-sounds": "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
  "digital-audio": "https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip",
  "sci-fi-sounds": "https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip",
  "rpg-audio": "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip",
  "music-jingles": "https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip",
};

/* ── SFX 매니페스트: 출력명 → (팩, zip 내 경로) ── */
const SFX = {
  // hover: tick_001 원본(중심 9.4kHz)은 날카롭고 tick_004(2.9kHz)는 비어 들림 →
  // 원본에 highshelf로 최상단만 깎아 중심 7.2kHz(요청 6~8kHz 대역)로. 어택(딱딱 걸림)은 유지.
  "ui-hover": { pack: "interface-sounds", path: "Audio/tick_001.ogg", targetDb: -20, filter: "highshelf=f=7000:g=-10" },
  // ui-click(게임 화면 버튼): 깔끔한 초단타 디지털 클릭. 이력: click_001=묵직/select_001=가벼움/
  // click2=물렁/mouseclick1=이질감/impactGeneric=버튼엔 어색(맵 전용으로 이동).
  "ui-click": { pack: "interface-sounds", path: "Audio/click_003.ogg" },
  // menu-click(시작 화면 버튼): "더 크게 느껴지게" — 도톰한 팝 drop_001(0.11s, crest 20.3dB) + 게인 +3dB
  "menu-click": { pack: "interface-sounds", path: "Audio/drop_001.ogg", targetDb: -15 },
  // map-click(맵 구역): 진짜 타격 녹음 — 영토 클릭의 타격감. 연타라 짧은 것(0.12s), 게인 +1dB.
  "map-click": { pack: "impact-sounds", path: "Audio/impactGeneric_light_001.ogg", targetDb: -17 },
  "game-start": { pack: "interface-sounds", path: "Audio/confirmation_002.ogg" },
  build: { pack: "impact-sounds", path: "Audio/impactPlank_medium_000.ogg" },
  upgrade: { pack: "digital-audio", path: "Audio/powerUp7.ogg" },
  destroy: { pack: "sci-fi-sounds", path: "Audio/explosionCrunch_000.ogg" },
  move: { pack: "rpg-audio", path: "Audio/cloth2.ogg" },
  combat: { pack: "impact-sounds", path: "Audio/impactMetal_medium_000.ogg" },
  "game-end": { pack: "music-jingles", path: "Audio/Pizzicato jingles/jingles_PIZZI01.ogg" },
  "warn-time": { pack: "digital-audio", path: "Audio/tone1.ogg" },
};

/* ── 사용자 제공 트랙 — 다운로드·변환하지 않고 보존한다 (LICENSES에만 기록) ── */
const USER_PROVIDED = {
  "bgm-menu": {
    title: "사용자 제공 메뉴 BGM",
    note: "2026-07-12 사용자 전달 mp3 — 무음 꼬리 3.7s 트림 + 평균 -24dB 정규화 + 192k 재인코딩만 적용",
  },
};

/* ── BGM (OpenGameArt, 페이지에서 CC0 확인함) ── */
const BGM = {
  "bgm-game": {
    url: "https://opengameart.org/sites/default/files/GalacticTemple.ogg",
    title: "Galactic Temple",
    author: "yd",
    page: "https://opengameart.org/content/galactic-temple",
  },
  "bgm-wait": {
    url: "https://opengameart.org/sites/default/files/audio_preview/b423b42.wav.ogg",
    title: "Loading Screen Loop",
    author: "HaelDB",
    page: "https://opengameart.org/content/loading-screen-loop",
    // 이 루프는 극도로 평탄(LRA~0.6)해서 mean -24로 맞추면 체감(LUFS)이 메뉴/게임(-22.3)보다
    // ~2 LU 처져 유독 작게 들린다. peak가 -13dB로 헤드룸이 넉넉하므로 mean -22로 올려 맞춘다.
    targetDb: -22,
  },
};

const SFX_TARGET_MEAN_DB = -18; // 러프 정규화 목표 (SFX)
const BGM_TARGET_MEAN_DB = -24; // BGM은 잔잔하게

async function download(url, dest) {
  if (existsSync(dest)) return;
  process.stdout.write(`↓ ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function meanVolumeDb(file) {
  const r = spawnSync(ffmpegPath, ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = (r.stderr ?? "").match(/mean_volume:\s*(-?[\d.]+) dB/);
  return m ? Number(m[1]) : null;
}

function convert(src, dest, { targetMeanDb, mono, bitrateArgs, filter }) {
  let measured = src;
  if (filter) {
    // 필터가 음량을 바꾸므로 필터 적용본 기준으로 게인 산출
    measured = src + ".filtered.wav";
    const rf = spawnSync(ffmpegPath, ["-hide_banner", "-y", "-i", src, "-af", filter, measured], { encoding: "utf8" });
    if (rf.status !== 0) throw new Error(`ffmpeg filter failed for ${src}:\n${rf.stderr}`);
  }
  const mean = meanVolumeDb(measured);
  const gain = mean === null ? 0 : Math.max(-12, Math.min(12, targetMeanDb - mean));
  const args = ["-hide_banner", "-y", "-i", measured];
  if (gain !== 0) args.push("-af", `volume=${gain.toFixed(1)}dB`);
  if (mono) args.push("-ac", "1");
  args.push("-codec:a", "libmp3lame", ...bitrateArgs, dest);
  const r = spawnSync(ffmpegPath, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${src}:\n${r.stderr}`);
  process.stdout.write(`✓ ${dest.split("/").pop()} (gain ${gain.toFixed(1)}dB)\n`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

// 1) Kenney 팩 다운로드 + 필요한 파일만 추출
const neededPacks = new Set(Object.values(SFX).map((s) => s.pack));
for (const pack of neededPacks) {
  const zipPath = join(tmpDir, `${pack}.zip`);
  await download(KENNEY_PACKS[pack], zipPath);
  const files = unzipSync(readFileSync(zipPath));
  for (const [id, spec] of Object.entries(SFX)) {
    if (spec.pack !== pack) continue;
    const data = files[spec.path];
    if (!data) throw new Error(`${spec.path} not in ${pack}`);
    writeFileSync(join(tmpDir, `${id}.ogg`), data);
  }
}

// 2) BGM 다운로드
for (const [id, spec] of Object.entries(BGM)) {
  await download(spec.url, join(tmpDir, `${id}.ogg`));
}

// 3) mp3 변환 (SFX = 모노 VBR q5, BGM = 스테레오 128k)
for (const [id, spec] of Object.entries(SFX)) {
  convert(join(tmpDir, `${id}.ogg`), join(outDir, `${id}.mp3`), {
    targetMeanDb: spec.targetDb ?? SFX_TARGET_MEAN_DB,
    mono: true,
    bitrateArgs: ["-q:a", "5"],
    filter: spec.filter,
  });
}
for (const [id, spec] of Object.entries(BGM)) {
  convert(join(tmpDir, `${id}.ogg`), join(outDir, `${id}.mp3`), {
    targetMeanDb: spec.targetDb ?? BGM_TARGET_MEAN_DB,
    mono: false,
    bitrateArgs: ["-b:a", "128k"],
  });
}

// 4) 사용자 제공 파일은 건드리지 않고 존재만 확인
for (const id of Object.keys(USER_PROVIDED)) {
  if (!existsSync(join(outDir, `${id}.mp3`)))
    process.stderr.write(`⚠ ${id}.mp3 없음 — 사용자 제공 파일이라 이 스크립트로 재생성할 수 없습니다\n`);
}

// 5) LICENSES.md
const lines = [
  "# public/sounds/ 라이선스",
  "",
  "사용자 제공 표기가 없는 파일은 전부 **CC0 1.0 (퍼블릭 도메인)** 원본을 mp3로 변환한 것입니다. 표기 의무는 없으나 출처를 기록합니다.",
  "",
  "## 효과음 — Kenney (kenney.nl, CC0)",
  "",
  "| 파일 | 원본 | 팩 |",
  "|---|---|---|",
  ...Object.entries(SFX).map(
    ([id, s]) => `| ${id}.mp3 | ${s.path} | [${s.pack}](https://kenney.nl/assets/${s.pack}) |`,
  ),
  "",
  "## BGM — OpenGameArt (CC0)",
  "",
  "| 파일 | 곡 | 작곡 | 출처 |",
  "|---|---|---|---|",
  ...Object.entries(BGM).map(([id, s]) => `| ${id}.mp3 | ${s.title} | ${s.author} | ${s.page} |`),
  "",
  "## 사용자 제공 (CC0 아님 — 배포 권리는 소유자 책임)",
  "",
  ...Object.entries(USER_PROVIDED).map(([id, s]) => `- ${id}.mp3 — ${s.title}: ${s.note}`),
  "",
  "재생성: `npm run sounds:fetch` (ffmpeg-static으로 변환, 러프 라우드니스 정규화 포함)",
  "",
];
writeFileSync(join(outDir, "LICENSES.md"), lines.join("\n"));

rmSync(tmpDir, { recursive: true, force: true });
process.stdout.write(`\n완료 → ${outDir}\n`);
