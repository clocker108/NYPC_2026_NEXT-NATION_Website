#!/usr/bin/env python3
# latest.py (구 sample-code-8): 사용자 설계 7페이즈 스크립트 변형(2026-07-03).
# 기반: sample-code.py — I/O·경로·관측 인프라 동일, 전략부(decide)만 교체.
from __future__ import annotations

import math
import os
import struct
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import NamedTuple

MAX_TURN = 200          # maximum turn (days)
START_GOLD = 500        # initial gold
START_WARRIORS = 3      # initial warriors
MOVE_COST = 10          # move cost
TRAIN_COST = 120        # train cost
WORK_INCOME = 15        # income per warrior
UPKEEP_PER_WARRIOR = 2  # upkeep per warrior
HQ_MAX_LEVEL = 5        # HQ max level
BASE_MAX_LEVEL = 3      # base max level
HQ_HEAL_COST = 1000     # HQ fix cost
BASE_HEAL_COST = 500    # base fix cost

# 가치망 사용 스위치 (구 NN 전용 — 현 봇에서는 _evaluate 미호출, 죽은 경로)
# 상수 테이블(STC8/STC9) data.bin은 이 스위치와 무관하게 항상 로드됨.
USE_MODEL = False

# 적응형 메타정책 개발 플래그 (2026-07-06, SC8_META=util). off(기본)=기존 FSM
# 동작 불변(스모크 green). on=하드 임계값 페이즈 가드를 명시 유틸리티로 점진
# 교체 → 리그로 current(룰+_POL) 대비 A/B, 이기면 활성화. 무회귀 개발.
META_UTIL = os.environ.get("SC8_META") == "util"

class HqLevelEntry(NamedTuple):
    upgrade_cost: int
    warrior_hp: int
    hp: int
    turret: int
    train_cap: int
    work_cap: int


class BaseLevelEntry(NamedTuple):
    cost: int
    hp: int
    turret: int
    work_cap: int


HQ_LEVELS: tuple[HqLevelEntry, ...] = (
    HqLevelEntry(0,     0, 0,  0, 0, 0),
    HqLevelEntry(0,     4, 10, 1, 1, 1),
    HqLevelEntry(600,   5, 15, 2, 1, 2),
    HqLevelEntry(1200,  6, 20, 2, 2, 3),
    HqLevelEntry(2400,  7, 25, 3, 2, 4),
    HqLevelEntry(3600,  8, 30, 3, 3, 5),
)
BASE_LEVELS: tuple[BaseLevelEntry, ...] = (
    BaseLevelEntry(0,    0,  0, 0),
    BaseLevelEntry(300,  6, 1, 1),
    BaseLevelEntry(600,  12, 1, 2),
    BaseLevelEntry(1000, 18, 2, 3),
)


class Side(Enum):
    LEFT = "A"
    RIGHT = "B"

    @property
    def opposite(self) -> "Side":
        return Side.RIGHT if self is Side.LEFT else Side.LEFT

    @classmethod
    def from_word(cls, w: str) -> "Side":
        return cls.LEFT if w == "LEFT" else cls.RIGHT

    @classmethod
    def from_char(cls, c: str) -> "Side":
        return cls.LEFT if c == "A" else cls.RIGHT


class BType(Enum):
    HQ = "HQ"
    BASE = "BASE"


class WState(Enum):
    STATIONARY = 0
    MOVING = 1


@dataclass(frozen=True)
class WarriorId:
    side: Side
    num: int

    def __str__(self) -> str:
        return f"{self.side.value}{self.num}"

    @classmethod
    def parse(cls, tok: str) -> "WarriorId":
        assert tok and tok[0] in ("A", "B")
        return cls(Side.from_char(tok[0]), int(tok[1:]))


@dataclass
class Warrior:
    id: WarriorId
    region: int
    hp: int
    state: WState = WState.STATIONARY
    target: int = 0


@dataclass
class Building:
    region: int
    side: Side
    type: BType
    level: int = 1
    hp: int = 10

    def current_hp(self) -> int:
        return HQ_LEVELS[self.level].hp if self.type is BType.HQ else BASE_LEVELS[self.level].hp

    def work_cap(self) -> int:
        return HQ_LEVELS[self.level].work_cap if self.type is BType.HQ else BASE_LEVELS[self.level].work_cap

    def apply_upgrade(self) -> None:
        self.level += 1
        self.hp = self.current_hp()

    def upgrade_cost(self) -> int:
        if self.type is BType.HQ:
            return HQ_LEVELS[self.level + 1].upgrade_cost
        else:
            return BASE_LEVELS[self.level + 1].cost


@dataclass
class GameMap:
    N: int = 0
    K: int = 0
    x: list[int] = field(default_factory=list)
    y: list[int] = field(default_factory=list)
    strongholds: list[int] = field(default_factory=list)
    adj: list[list[int]] = field(default_factory=list)
    my_side: Side = Side.LEFT
    my_hq: int = 0
    opp_hq: int = 0

    def hq_of(self, s: Side) -> int:
        return 0 if s is Side.LEFT else self.N - 1


@dataclass
class GameState:
    gold: int = START_GOLD
    my_countdown: int = 5
    opp_countdown: int = 5
    warriors: list[Warrior] = field(default_factory=list)
    buildings: list[Building] = field(default_factory=list)

    def find_building(self, region: int) -> Building | None:
        return next((b for b in self.buildings if b.region == region), None)

    def find_warrior(self, wid: WarriorId) -> Warrior | None:
        return next((w for w in self.warriors if w.id == wid), None)


@dataclass
class Actions:
    train_n: int = 0
    moves: list[tuple[WarriorId, int]] = field(default_factory=list)
    upgrades: list[int] = field(default_factory=list)


@dataclass
class OpponentModel:
    """상대 관측(최소한만): 웨이브 '발진' 감지 + 러시 판별 + 최대 병력.
    (구 하이브리드의 터틀/소모전 분류 등은 단일 아키타입에서 불필요 → 제거)"""
    peak_army: int = 0
    earliest_hq_threat: int = 999    # 적이 우리 HQ 근처(≥2명)에 처음 온 턴(러시 감지)
    advancing: int = 0               # 이번 턴 우리 HQ 쪽으로 전진한 적 수(발진 감지)
    train_rate: float = 9.0          # 상대 훈련 속도 관측(명/턴, 최근 30턴 창)
    _prev_hqdist: dict = field(default_factory=dict)   # 적 id.num → 지난 턴 HQ 거리
    _seen_ids: set = field(default_factory=set)        # 관측된 적 id(신병 감지용)
    _train_hist: list = field(default_factory=list)    # (턴, 신규 관측 수)

    def observe(self, turn: int, enemy_warriors: list, my_hq: int, opp_hq: int,
                dist: list[list[float]]) -> None:
        opp_d = max(1.0, dist[my_hq][opp_hq])
        self.peak_army = max(self.peak_army, len(enemy_warriors))
        # 상대 훈련 속도 실측(2026-07-04, 실전 8(5).txt): TRAIN 이벤트로 상대
        # 신병 id가 그대로 보이므로 '증원 여지'는 훈련캡(상한)이 아니라 최근
        # 관측 속도로 추정 가능 — 캡×ETA 과대추정이 총공세를 t189 마감까지
        # 홀드시키는 동안 상대가 진짜 수비를 모으던 패인의 수정.
        new_n = 0
        for e in enemy_warriors:
            if e.id.num not in self._seen_ids:
                self._seen_ids.add(e.id.num)
                new_n += 1
        self._train_hist.append((turn, new_n))
        while self._train_hist and self._train_hist[0][0] < turn - 30:
            self._train_hist.pop(0)
        span = max(1, turn - self._train_hist[0][0] + 1)
        self.train_rate = sum(n for _, n in self._train_hist) / span
        near_hq = sum(1 for e in enemy_warriors
                      if dist[e.region][my_hq] <= opp_d * 0.35)
        if near_hq >= 2:
            self.earliest_hq_threat = min(self.earliest_hq_threat, turn)
        # 웨이브 '발진' 감지: 지난 턴보다 우리 HQ에 가까워진 적 수. 눌러앉은 수비대
        # (전진 0)와 실제 몰려오는 웨이브를 구분한다 — 철수 중인 웨이브에 반응해
        # 병력을 헌납하던 오발(신7.txt)의 방지 장치.
        adv = 0
        for e in enemy_warriors:
            d = dist[e.region][my_hq]
            pd = self._prev_hqdist.get(e.id.num)
            if pd is not None and d < pd:
                adv += 1
            self._prev_hqdist[e.id.num] = d
        self.advancing = adv

    @property
    def is_rusher(self) -> bool:
        return self.earliest_hq_threat <= 35


@dataclass
class Plan:
    """게임 전체 지속 상태: 페이즈 스케줄(게임당 1회 계산) + 방어창.
      - t_mass : 이 턴부터 확장·업글을 멈추고 풀캡 양산(떼거리 조립)
      - t_push : 이 턴부터 전군을 적 HQ로 발진(홉 기반 도착·공성 예산 역산)
      - defend_until : 이 턴까지 방어태세 유지(웨이브 창 — 소환/해제 플리커 방지)
      - stance : 관측/디버그 라벨
    """
    t_mass: int = 0
    t_push: int = 0
    defend_until: int = 0
    wave_target: int | None = None   # 롤링 웨이브 커밋 목표(부술 때까지 유지)
    wave_since: int = 0
    stance: str = "ECON"


def make_base(region: int, s: Side) -> Building:
    return Building(region, s, BType.BASE, 1, BASE_LEVELS[1].hp)


def readln() -> str:
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return line.rstrip("\n")


def read_tokens() -> list[str]:
    return readln().split()


def parse_init() -> tuple[GameMap, GameState]:
    M = GameMap()

    t = read_tokens()
    assert len(t) >= 2 and t[0] == "READY"
    M.my_side = Side.from_word(t[1])

    t = read_tokens()
    M.N, M.K = int(t[0]), int(t[1])

    M.x = [int(v) for v in read_tokens()]  # x_0 x_1 ... x_{N-1}
    M.y = [int(v) for v in read_tokens()]  # y_0 y_1 ... y_{N-1}

    M.strongholds = sorted(int(v) for v in read_tokens())  # K strongholds

    M.adj = [[] for _ in range(M.N)]
    for r in range(M.N):
        t = read_tokens()  # deg n_1 n_2 ...
        deg = int(t[0])
        M.adj[r] = sorted(int(v) for v in t[1:1 + deg])

    M.my_hq = M.hq_of(M.my_side)
    M.opp_hq = M.hq_of(M.my_side.opposite)

    S = GameState()
    opp = M.my_side.opposite
    for sfx in range(1, START_WARRIORS + 1):
        S.warriors.append(Warrior(WarriorId(M.my_side, sfx), M.my_hq, HQ_LEVELS[1].warrior_hp))
        S.warriors.append(Warrior(WarriorId(opp, sfx), M.opp_hq, HQ_LEVELS[1].warrior_hp))
    S.buildings.append(
        Building(0, Side.LEFT, BType.HQ, 1, HQ_LEVELS[1].hp)
    )
    S.buildings.append(
        Building(M.N - 1, Side.RIGHT, BType.HQ, 1, HQ_LEVELS[1].hp)
    )

    print("OK", flush=True)
    return M, S


def read_turn_start() -> int | None:
    line = readln()
    if line == "FINISH":
        return None
    t = line.split()
    assert t and t[0] == "START"
    return int(t[2])


def read_turn_result(S: GameState, M: GameMap, submitted: Actions) -> None:
    for region in submitted.upgrades:
        b = S.find_building(region)
        if b is None:
            S.gold -= BASE_LEVELS[1].cost
            S.buildings.append(make_base(region, M.my_side))
        else:
            max_level = HQ_MAX_LEVEL if b.type is BType.HQ else BASE_MAX_LEVEL
            if b.level >= max_level:
                cost = HQ_HEAL_COST if b.type is BType.HQ else BASE_HEAL_COST
                S.gold -= cost
                b.hp = b.current_hp()
            else:
                S.gold -= b.upgrade_cost()
                b.apply_upgrade()

    for wid, target in submitted.moves:
        b = S.find_building(target)
        cost = 0 if (b is not None and b.side is M.my_side) else MOVE_COST
        S.gold -= cost
        w = S.find_warrior(wid)
        if w is not None:
            w.state = WState.MOVING
            w.target = target

    S.gold -= TRAIN_COST * submitted.train_n

    line = readln()
    if line == "FINISH":
        sys.exit(0)
    t = line.split()
    assert t and t[0] == "TURN"

    t = read_tokens()
    S.my_countdown = int(t[2])
    S.opp_countdown = int(t[4])

    # UPGRADE
    t = read_tokens()  # "UPGRADE N"
    n = int(t[1])
    for _ in range(n):
        r = read_tokens()  # "<A|B> <region>"
        s = Side.from_char(r[0][0])
        region = int(r[1])
        b = S.find_building(region)
        if b is None:
            S.buildings.append(make_base(region, s))
        elif b.side is not M.my_side:
            max_level = HQ_MAX_LEVEL if b.type is BType.HQ else BASE_MAX_LEVEL
            if b.level >= max_level:
                b.hp = b.current_hp()
            else:
                b.apply_upgrade()

    # TRAIN
    t = read_tokens()  # "TRAIN N"
    n = int(t[1])
    if n > 0:
        ids = read_tokens()
        for i in range(n):
            wid = WarriorId.parse(ids[i])
            hq_region = M.hq_of(wid.side)
            hq_b = S.find_building(hq_region)
            hq_level = hq_b.level if hq_b is not None else 1
            S.warriors.append(Warrior(wid, hq_region, HQ_LEVELS[hq_level].warrior_hp))

    # MOVE
    t = read_tokens()  # "MOVE N"
    n = int(t[1])
    for _ in range(n):
        r = read_tokens()
        wid = WarriorId.parse(r[0])
        region = int(r[1])
        w = S.find_warrior(wid)
        if w is not None:
            w.region = region
            if (wid.side is M.my_side
                    and w.state is WState.MOVING
                    and w.region == w.target):
                w.state = WState.STATIONARY

    # DAMAGE
    t = read_tokens()  # "DAMAGE N"
    n = int(t[1])
    for _ in range(n):
        r = read_tokens()
        wid = WarriorId.parse(r[1])
        damage = int(r[2])
        w = S.find_warrior(wid)
        if w is not None:
            w.hp -= damage
    S.warriors = [w for w in S.warriors if w.hp > 0]

    # SIEGE
    t = read_tokens()  # "SIEGE N"
    n = int(t[1])
    for _ in range(n):
        r = read_tokens()
        region = int(r[1])
        dmg = int(r[2])
        b = S.find_building(region)
        if b is not None:
            b.hp -= dmg
    S.buildings = [b for b in S.buildings if b.hp > 0]

    readln()  # "END"

    income = 0
    for b in S.buildings:
        if b.side is not M.my_side:
            continue
        count = sum(
            1 for w in S.warriors
            if w.id.side is M.my_side and w.region == b.region
        )
        income += WORK_INCOME * min(count, b.work_cap())
    S.gold += income

    alive = sum(1 for w in S.warriors if w.id.side is M.my_side)
    S.gold = max(0, S.gold - UPKEEP_PER_WARRIOR * alive)


@dataclass
class Paths:
    dist: list[list[float]]
    nxt: list[list[int]]
    hops: list[list[int]]   # 경로 홉 수 = 실제 도착까지 걸리는 턴 수(턴당 1홉 전진)


def euclid_ceil(M: GameMap, u: int, v: int) -> float:
    return math.ceil(math.hypot(M.x[u] - M.x[v], M.y[u] - M.y[v]))


def calculate_paths(M: GameMap) -> Paths:
    INF = math.inf
    N = M.N

    # Pure-Python Floyd-Warshall (numpy 없이 PyPy/CPython 양쪽에서 동작).
    # 게임 시작 시 1회만 실행 — N=105에서도 PyPy ~0.01s, CPython ~0.07s로 무시 가능.
    dist: list[list[float]] = [[INF] * N for _ in range(N)]
    for i in range(N):
        dist[i][i] = 0.0
    for u in range(N):
        du = dist[u]
        for v in M.adj[u]:
            w = euclid_ceil(M, u, v)
            if w < du[v]:
                du[v] = w

    for k in range(N):
        dk = dist[k]
        for i in range(N):
            di = dist[i]
            dik = di[k]
            if dik == INF:
                continue
            for j in range(N):
                nv = dik + dk[j]
                if nv < di[j]:
                    di[j] = nv

    # Build nxt table (O(N² × avg_degree), pure Python is fast enough here)
    nxt = [[-1] * N for _ in range(N)]
    for i in range(N):
        nxt[i][i] = i
    for u in range(N):
        du = dist[u]
        for v in range(N):
            if u == v or du[v] == INF:
                continue
            best_score = INF
            for nb in M.adj[u]:
                if dist[nb][v] == INF:
                    continue
                score = euclid_ceil(M, u, nb) + dist[nb][v]
                if score < best_score:
                    best_score = score
                    nxt[u][v] = nb

    # 홉 수 테이블: 전사는 매턴 1홉씩 전진하므로 "도착까지 몇 턴"은 dist(유클리드
    # 가중 거리)가 아니라 경로 홉 수다. dist는 상대 비교용, hops는 절대 턴 수용
    # (올인 역공의 '방어가 늦었나' 판정 등). nxt 경로를 따라가며 접미사를 한꺼번에
    # 채우는 방식이라 전체 O(N²).
    hops = [[-1] * N for _ in range(N)]
    for i in range(N):
        hops[i][i] = 0
    for u in range(N):
        for v in range(N):
            if hops[u][v] != -1 or nxt[u][v] == -1:
                continue
            chain = [u]
            cur = nxt[u][v]
            while hops[cur][v] == -1:
                chain.append(cur)
                cur = nxt[cur][v]
            h = hops[cur][v]
            for node in reversed(chain):
                h += 1
                hops[node][v] = h
    return Paths(dist, nxt, hops)


def next_step(P: Paths, u: int, v: int) -> int:
    """Returns the next step on the path from u to v. Returns -1 if the path is not reachable."""
    return P.nxt[u][v]


def path(P: Paths, u: int, v: int) -> list[int]:
    """Returns the path from u to v as [u, ..., v]. Returns an empty list if the path is not reachable."""
    if P.nxt[u][v] == -1:
        return []
    out = [u]
    while u != v:
        u = P.nxt[u][v]
        out.append(u)
    return out


# ─── ML state evaluator ───────────────────────────────────────────────────────
# 12 features (see _evaluate call in decide() for the feature list).
# Outputs: [economy_w, attack_str, defend_thr]  – all in [0, 1].
#
# If data.bin exists (written by train_model.py) the trained MLP is used.
# Otherwise falls back to hand-tuned linear weights extended to 12 inputs.
# fallback 가중치(순수 파이썬 리스트). data.bin 없을 때만 사용.
_EVAL_W = [
    [-3.0,  0.5, -0.3, -0.2, -0.3,  0.0,  0.0, -0.4,  0.0,  0.0,  0.0,  0.0],
    [ 3.0, -0.2,  0.6,  0.4,  0.4,  0.0, -0.5,  0.2,  0.0,  0.0,  0.0,  0.0],
    [ 0.2, -0.2, -0.3, -0.1, -0.2,  3.0, -0.1, -0.1,  0.0,  0.0,  0.0,  0.0],
]
_EVAL_B = [1.8, -2.0, -1.5]

_DATA_BIN_MAGIC = b'STRB'


def _sigmoid(v: float) -> float:
    # 오버플로 방지 클립(순수 파이썬 math.exp는 큰 값에서 OverflowError)
    if v < -60.0:
        return 0.0
    if v > 60.0:
        return 1.0
    return 1.0 / (1.0 + math.exp(-v))


def _load_model(path: str) -> list[tuple[list[list[float]], list[float]]]:
    """data.bin에서 MLP 가중치를 순수 파이썬 리스트로 로드. Returns [(W, b), …].
    W[j] = j번째 출력 뉴런의 입력 가중치 행(list[float]), b = 편향(list[float])."""
    with open(path, 'rb') as f:
        if f.read(4) != _DATA_BIN_MAGIC:
            raise ValueError("data.bin: wrong magic")
        n = struct.unpack('<I', f.read(4))[0]
        layers = []
        for _ in range(n):
            rows, cols = struct.unpack('<II', f.read(8))
            flat = struct.unpack('<%df' % (rows * cols), f.read(rows * cols * 4))
            W = [list(flat[r * cols:(r + 1) * cols]) for r in range(rows)]
            b = list(struct.unpack('<%df' % rows, f.read(rows * 4)))
            layers.append((W, b))
    return layers

try:
    _MODEL: list[tuple[list[list[float]], list[float]]] | None = (
        _load_model('data.bin') if USE_MODEL else None)
except Exception:
    _MODEL = None


def _evaluate(features: list[float]) -> list[float]:
    """Return [economy_w, attack_str, defend_thr] from 12 game-state features.
    numpy 없이 순수 파이썬 순전파(PyPy에서 ~2.4ms/call)."""
    if _MODEL is not None:
        h = features
        last = len(_MODEL) - 1
        for i, (W, b) in enumerate(_MODEL):
            out = [0.0] * len(b)
            for j, row in enumerate(W):
                s = b[j]
                for k in range(len(row)):
                    s += row[k] * h[k]
                out[j] = s
            if i < last:
                h = [v if v > 0.0 else 0.0 for v in out]   # ReLU
            else:
                h = [_sigmoid(v) for v in out]              # sigmoid
        if len(h) == 3:
            # 다중 출력: [0]economy [1]attack [2]defend (각각 독립 학습)
            return h
        # 구형 단일 출력 모델 호환
        win_prob = h[0]
        economy  = _sigmoid(-5.0 * (win_prob - 0.5))
        return [economy, win_prob, win_prob]
    # Fallback: 손튜닝 선형층
    return [_sigmoid(sum(_EVAL_W[j][k] * features[k] for k in range(12)) + _EVAL_B[j])
            for j in range(3)]


def _greedy_assign(pool: list[Warrior], slots: list[int],
                   dist: list[list[float]]) -> dict[WarriorId, int]:
    """O(n² log n) greedy min-cost assignment; optimal for n < ~20."""
    if not pool or not slots:
        return {}
    pairs = sorted(
        (dist[w.region][s], i, j)
        for i, w in enumerate(pool)
        for j, s in enumerate(slots)
    )
    used_w: set[int] = set()
    used_s: set[int] = set()
    result: dict[WarriorId, int] = {}
    for _, i, j in pairs:
        if i not in used_w and j not in used_s:
            result[pool[i].id] = slots[j]
            used_w.add(i)
            used_s.add(j)
    return result


def emit(a: Actions) -> None:
    out: list[str] = ["COMMAND"]
    for wid, target in a.moves:
        out.append(f"MOVE {wid} {target}")
    for r in a.upgrades:
        out.append(f"UPGRADE {r}")
    if a.train_n > 0:
        out.append(f"TRAIN {a.train_n}")
    out.append("END")
    sys.stdout.write("\n".join(out) + "\n")
    sys.stdout.flush()


# ── 전략 상수 (latest.py, 구 sample-code-8: 사용자 설계 7페이즈 스크립트, 2026-07-03) ───────
# 시작~50 기지 확장만 → 50~60 HQ 전사 비축만 → 60~ 원정대 12명이 상대 기지를
# 시계방향으로 순회 파괴 후 귀환(기지 가리슨은 부동) → 자금 4000 비축 + 기지
# 업글 + 가리슨(L1은 2명, L2+는 레벨 수) → 대규모 공격시 전력 양산 방어(함락 임박시에만
# 가리슨 총동원) → 해결/170~ HQ 업글+양산(잔고 600만 유지) → 180~ 대량 선발 후
# 매턴 잉여 소량 후속 총공세(HQ에는 레벨 수만큼 잔류).
T_MASS_START = 50      # 이 턴부터 HQ 전사 비축에만 집중
T_TOUR_START = 60      # 이 턴부터 시계방향 원정
TOUR_SIZE    = 12      # 원정대 규모(사용자 지정 "12명 정도")
TOUR_STALL   = 30      # 한 기지 공성 교착 한도(초과시 다음 기지로 이동)
TOUR_FORM_WAIT  = 10   # 편성 대기 한도: 초과하면 6명 이상만 모여도 발진
TOUR_FORM_ABORT = 25   # 편성 포기 한도: 이 안에 못 모으면 원정 취소 → 정비
TOUR_COOLDOWN   = 10   # 재원정 최소 대기(사용자 지정: 완료 10턴 이후)
RETOUR_SOFT     = 2    # 재원정 발동 최소 '무른 기지'(L≤2 & 수비≤2) 수
# 사용자 지정(패인: 종반 HQ 레벨 열세 = TURN_LIMIT 타이브레이크 패배):
# t150 이후엔 원정을 돌지 않는다 — 그 자산·전사를 HQ 업글·총공세에 비축.
# 출발은 135에 마감(편성~순회 ~15턴 소요), 진행 중이어도 150엔 강제 귀환.
RETOUR_LAST     = 135  # 재원정 출발 마감
RETOUR_END      = 150  # 재원정 강제 귀환(첫 원정의 165보다 이른 한도)
SORTIE_START    = 150  # 이 턴부터 기지 가리슨 출격(원정 대신, 사용자 지정)
SORTIE_STALL    = 12   # 출격 교착 한도(초과시 귀환)
GOLD_TARGET  = 4000    # GATHER 목표 잔고(업글은 cost+2000 게이트로 병행 우상향)
T_CONSOL     = 170     # 공격이 안 오면 이 턴부터 정비(HQ 업글+양산, 잔고 600)
T_FINAL      = 180     # 총공세 개시
GUARD_TURNS  = 25      # 개막 러시 가드(기존 봇과 동일: HQ에 경비 1 잔류)


# ══════════════════════════════════════════════════════════════════════
# 추상 포워드모델 + 매크로 룩어헤드 (S2, 2026-07-06)
# ----------------------------------------------------------------------
# 커밋 seam(`_push_race_ok`)이 "지금 데스볼을 커밋할까 vs 대기할까"를
# **양쪽 K턴 투영·비교**로 판정하게 하는 경량 포워드모델. 손튜닝 일방
# 휴리스틱은 실측 regression(이기는 커밋 차단→비축군 아사)으로 폐기됐고,
# 커밋은 '커밋 vs 대기' 비교 문제라 룩어헤드가 필수임이 실증됐다.
#
# 상태 = 측당 스칼라(gold, home, away, hqlvl, hqhp, bases, wcap) + eta.
# 실엔진 하루 해소순서를 축약 재현한다(league_tool.py 검증):
#   훈련(gold 차감·HQ 스폰) → 진군(1홉) → 공성전투 → 수입 → 유지비(아사).
# 공성 규칙(실엔진 apply_day_combat/siege 축약):
#   siege_dmg = max(0, 공격자수 − 수비총HP);  HQ.hp -= siege_dmg
#   공격자는 매턴 (수비수 + 포탑)HP 손실;  수비수는 공격자수만큼 HP 손실
# 아사(apply_evening_upkeep 축약): gold<upkeep → 못 낸 병사 1HP 손실.
# 순수 파이썬(PyPy/CPython 공통, numpy 불요) — seam은 피벗턴에만 걸리므로
# 롤아웃 2회(커밋·대기)×K는 매턴 예산에 무시할 수준(~수십 us).
# TODO(S3): 상대 매크로 분기(minimax)·풀 7페이즈 트리로 MCTS 확장.
# ══════════════════════════════════════════════════════════════════════

_MS_K       = 22       # 롤아웃 지평(턴). eta(대형맵 ~12) + 공성 여유
_MS_MARGIN  = 0.04     # 커밋 우위 최소 마진(대기가 안전한 기본 — 애매하면 대기)


class _MState:
    """포워드모델 상태(측당 스칼라). m_=아군, o_=상대. 병력은 **지속 HP풀**로
    추적(부분 공성/아사 데미지 유지 — count만 쓰면 매턴 full-hp로 '회복'해
    공성이 영영 안 뚫리는 과대비관 버그). away=적 HQ로 커밋된 분견대(진군/공성),
    march=도착까지 남은 홉(>0 진군, 0 공성, -1 없음). 병력수 = ceil(풀/whp)."""
    __slots__ = (
        "m_gold", "m_home_hp", "m_away_hp", "m_march", "m_hqlvl", "m_hqhp",
        "m_wcap", "m_tcap",
        "o_gold", "o_home_hp", "o_away_hp", "o_march", "o_hqlvl", "o_hqhp",
        "o_wcap", "o_tcap",
    )

    def clone(self) -> "_MState":
        s = _MState.__new__(_MState)
        for f in _MState.__slots__:
            setattr(s, f, getattr(self, f))
        return s


def _whp(lvl: int) -> int:
    return HQ_LEVELS[max(1, min(HQ_MAX_LEVEL, lvl))].warrior_hp


def _turret(lvl: int) -> int:
    return HQ_LEVELS[max(1, min(HQ_MAX_LEVEL, lvl))].turret


def _tcap(lvl: int) -> int:
    return HQ_LEVELS[max(1, min(HQ_MAX_LEVEL, lvl))].train_cap


def _pn(pool: float, whp: int) -> int:
    """HP풀 → 병력수(ceil)."""
    return int(math.ceil(pool / whp)) if pool > 0 else 0


def _ms_step(s: "_MState") -> None:
    """양측 하루를 제자리 진행 — 실엔진 해소순서 축약:
    훈련(gold차감·스폰) → 진군 → 공성전투 → 수입 → 유지비(아사).
    공성·전투는 턴 시작 병력수 기준으로 대칭 계산."""
    mw, ow = _whp(s.m_hqlvl), _whp(s.o_hqlvl)
    m_home_n = _pn(s.m_home_hp, mw)
    o_home_n = _pn(s.o_home_hp, ow)
    m_away_n = _pn(s.m_away_hp, mw)
    o_away_n = _pn(s.o_away_hp, ow)

    # 1) 훈련: 유지비 버퍼 남기고 감당분 스폰(경제→병력 전환). 증원속도 =
    #    측별 tcap(상대는 seam에서 0 — forward 커밋 전제라 HQ 증원 안 함).
    m_afford = max(0, int(s.m_gold - UPKEEP_PER_WARRIOR * (m_home_n + m_away_n))) // TRAIN_COST
    m_tr = min(s.m_tcap, m_afford)
    s.m_gold -= m_tr * TRAIN_COST
    s.m_home_hp += m_tr * mw
    m_home_n += m_tr
    o_afford = max(0, int(s.o_gold - UPKEEP_PER_WARRIOR * (o_home_n + o_away_n))) // TRAIN_COST
    o_tr = min(s.o_tcap, o_afford)
    s.o_gold -= o_tr * TRAIN_COST
    s.o_home_hp += o_tr * ow
    o_home_n += o_tr

    # 2) 진군(1홉).
    if s.m_march > 0:
        s.m_march -= 1
    if s.o_march > 0:
        s.o_march -= 1

    # 3) 공성전투(동시, 턴 시작값 기준). 실엔진: siege = 남는 공격자
    #    = max(0, 공격자수 − 수비총HP풀). 공격자는 (수비수+포탑)HP, 수비수는
    #    공격자수만큼 HP 손실 — 부분 데미지는 풀에 지속.
    if m_away_n > 0 and s.m_march == 0:
        siege = m_away_n - s.o_home_hp
        if siege > 0:
            s.o_hqhp -= siege
        s.m_away_hp -= (o_home_n + _turret(s.o_hqlvl))
        s.o_home_hp -= m_away_n
    if o_away_n > 0 and s.o_march == 0:
        siege = o_away_n - s.m_home_hp
        if siege > 0:
            s.m_hqhp -= siege
        s.o_away_hp -= (m_home_n + _turret(s.m_hqlvl))
        s.m_home_hp -= o_away_n
    if s.m_away_hp < 0:
        s.m_away_hp = 0.0
    if s.o_away_hp < 0:
        s.o_away_hp = 0.0
    if s.m_home_hp < 0:
        s.m_home_hp = 0.0
    if s.o_home_hp < 0:
        s.o_home_hp = 0.0
    if s.m_away_hp <= 0:                 # 분견대 소멸 → march 리셋
        s.m_march = -1
    if s.o_away_hp <= 0:
        s.o_march = -1

    # 4) 수입: 일꾼 = min(home_n, wcap). 공성 손실 반영해 재계산.
    m_home_n = _pn(s.m_home_hp, mw)
    o_home_n = _pn(s.o_home_hp, ow)
    s.m_gold += WORK_INCOME * min(m_home_n, s.m_wcap)
    s.o_gold += WORK_INCOME * min(o_home_n, s.o_wcap)

    # 5) 유지비/아사: 못 내면 병사 1HP씩(home풀 우선 차감 — 일꾼 붕괴가
    #    수입붕괴 소용돌이). 남은 굶주림은 away풀로.
    m_away_n = _pn(s.m_away_hp, mw)
    o_away_n = _pn(s.o_away_hp, ow)
    _ms_upkeep_side(s, "m", m_home_n + m_away_n, mw)
    _ms_upkeep_side(s, "o", o_home_n + o_away_n, ow)


def _ms_upkeep_side(s: "_MState", side: str, total_n: int, whp: int) -> None:
    gold = getattr(s, side + "_gold")
    cost = UPKEEP_PER_WARRIOR * total_n
    if gold >= cost:
        setattr(s, side + "_gold", gold - cost)
        return
    unpaid = int((cost - gold) // UPKEEP_PER_WARRIOR)   # 못 낸 병사 = 아사 1HP
    setattr(s, side + "_gold", 0.0)
    home_hp = getattr(s, side + "_home_hp") - unpaid
    if home_hp < 0:
        away_hp = getattr(s, side + "_away_hp") + home_hp   # 초과분 away로
        setattr(s, side + "_away_hp", away_hp if away_hp > 0 else 0.0)
        home_hp = 0.0
    setattr(s, side + "_home_hp", home_hp)


def _ms_value(s: "_MState") -> float:
    """터미널 평가 ∈ [-1,1]. HQ 함락은 결정적(±1). 그 외 = HQ레이스(상대
    HQ에 준 손상 − 내 HQ 손상) + 내 아사위험(순수입) + 병력차의 정규 가중합.
    커밋 결정은 이 절대값이 아니라 커밋/대기 두 롤아웃의 **차이**에서 나옴."""
    o_dead = s.o_hqhp <= 0
    m_dead = s.m_hqhp <= 0
    if o_dead and not m_dead:
        return 1.0
    if m_dead and not o_dead:
        return -1.0
    if m_dead and o_dead:
        return 0.0
    mw, ow = _whp(s.m_hqlvl), _whp(s.o_hqlvl)
    m_home_n, m_away_n = _pn(s.m_home_hp, mw), _pn(s.m_away_hp, mw)
    o_home_n, o_away_n = _pn(s.o_home_hp, ow), _pn(s.o_away_hp, ow)
    o_max = float(HQ_LEVELS[max(1, min(HQ_MAX_LEVEL, s.o_hqlvl))].hp)
    m_max = float(HQ_LEVELS[max(1, min(HQ_MAX_LEVEL, s.m_hqlvl))].hp)
    o_frac = 1.0 - max(0.0, s.o_hqhp) / o_max      # 상대 HQ 깎은 비율(좋음)
    m_frac = 1.0 - max(0.0, s.m_hqhp) / m_max      # 내 HQ 깎인 비율(나쁨)
    hq_race = o_frac - m_frac
    m_net = WORK_INCOME * min(m_home_n, s.m_wcap) - UPKEEP_PER_WARRIOR * (
        m_home_n + m_away_n)                        # 내 순수입(아사 신호)
    econ = math.tanh(m_net / 40.0)
    army = math.tanh(((m_home_n + m_away_n) - (o_home_n + o_away_n)) / 12.0)
    v = 0.60 * hq_race + 0.28 * econ + 0.12 * army
    if v > 0.95:
        v = 0.95
    elif v < -0.95:
        v = -0.95
    return v


def _ms_rollout(s: "_MState", k: int) -> float:
    """K턴 투영 후 가치. HQ 함락 시 조기 종료."""
    for _ in range(k):
        _ms_step(s)
        if s.o_hqhp <= 0 or s.m_hqhp <= 0:
            break
    return _ms_value(s)


def _macro_commit_better(base: "_MState", force: int, eta: int,
                         k: int = _MS_K, margin: float = _MS_MARGIN) -> bool:
    """base 상태에서 force명을 지금 커밋(적 HQ로 발진) vs 대기를 각각 K턴
    투영·비교. 커밋이 마진 이상 나으면 True(=커밋). 룩어헤드로 '이기는 커밋'은
    통과, '아사 유발 커밋'은 차단."""
    # 커밋 분기: force명(HP풀)을 home→away 이동, eta 후 도착.
    sc = base.clone()
    mw = _whp(sc.m_hqlvl)
    force = max(0, min(force, _pn(sc.m_home_hp, mw)))
    force_hp = float(force * mw)
    sc.m_home_hp = max(0.0, sc.m_home_hp - force_hp)
    sc.m_away_hp += force_hp
    sc.m_march = eta                     # 새 분견대가 eta 홉 뒤 적 HQ 도착
    cv = _ms_rollout(sc, k)
    # 대기 분기: force는 집에 남아 방어·생산.
    wv = _ms_rollout(base.clone(), k)
    ok = cv > wv + margin
    _dbg = os.environ.get("SC8_DBG")     # 캘리브레이션용 경량 로그(재계산 없음)
    if _dbg:
        with open(_dbg, "a") as _fh:
            _fh.write(f"force={force} eta={eta} ohqL{base.o_hqlvl}hp{base.o_hqhp:.0f} "
                      f"odef_hp={base.o_home_hp:.0f} raid_hp={base.o_away_hp:.0f}@{base.o_march} "
                      f"mygold={base.m_gold:.0f} wcap={base.m_wcap} | "
                      f"cv={cv:+.3f} wv={wv:+.3f} -> {'COMMIT' if ok else 'WAIT'}\n")
    return ok


# ── 튜닝 상수 로더(2026-07-04): data.bin에서 위 전략 상수의 '숫자만'
# 덮어쓴다. 로직은 불변. 파일이 없거나 매직이 다르거나(구 신경망 STRB
# 포함) 어떤 예외든 나면 아무것도 바꾸지 않는다(fail-closed) — data.bin을
# 지우면 원본(8전8승) 동작 그대로. 값은 testing-tool 대결 그리드서치
# 산출물. SC8_TUNE 환경변수는 튜너 전용 경로 오버라이드.
#   STC8 = 평면 테이블(맵 무관, 로드 즉시 적용)
#   STC9 = 맵 크기(N) 구간별 테이블(2026-07-04 확장, 사용자 지시) —
#          [(n_max, {상수: 값})] 오름차순, 맵 파싱 직후 N ≤ n_max인 첫
#          구간을 적용(_apply_tuned_constants). 유닛테스트처럼 main()을
#          거치지 않으면 STC9는 미적용 = 기본값(안전).
_TUNABLE_CONSTS = (
    "T_MASS_START", "T_TOUR_START", "TOUR_SIZE", "TOUR_STALL",
    "TOUR_FORM_WAIT", "TOUR_FORM_ABORT", "TOUR_COOLDOWN", "RETOUR_SOFT",
    "RETOUR_LAST", "RETOUR_END", "SORTIE_START", "SORTIE_STALL",
    "GOLD_TARGET", "T_CONSOL", "T_FINAL", "GUARD_TURNS")
_TUNED_BUCKETS: list = []      # STC9: [(n_max, {상수: 값})] 오름차순


def _read_kv(f, n: int) -> dict:
    d = {}
    for _ in range(n):
        klen = struct.unpack("<B", f.read(1))[0]
        key = f.read(klen).decode("ascii")
        val = struct.unpack("<i", f.read(4))[0]
        if key in _TUNABLE_CONSTS:
            d[key] = val
    return d


def _load_tuned_constants() -> None:
    try:
        with open(os.environ.get("SC8_TUNE", "data.bin"), "rb") as f:
            magic = f.read(4)
            if magic == b"STC8":
                n = struct.unpack("<I", f.read(4))[0]
                globals().update(_read_kv(f, n))
            elif magic == b"STC9":
                nb = struct.unpack("<I", f.read(4))[0]
                for _ in range(nb):
                    n_max, nk = struct.unpack("<iI", f.read(8))
                    _TUNED_BUCKETS.append((n_max, _read_kv(f, nk)))
                _TUNED_BUCKETS.sort(key=lambda b: b[0])
    except Exception:
        pass


def _apply_tuned_constants(n_zones: int) -> None:
    """맵 크기 확정 직후 호출 — N이 속한 구간의 상수 세트 적용."""
    try:
        for n_max, d in _TUNED_BUCKETS:
            if n_zones <= n_max:
                globals().update(d)
                return
    except Exception:
        pass


_load_tuned_constants()


def decide(S: GameState, M: GameMap, P: Paths, turn: int,
           OM: OpponentModel | None = None,
           plan: Plan | None = None) -> Actions:
    """사용자 설계 페이즈 스크립트. 기존 봇(sample-code.py)의 관측·경로·발령
    인프라 위에 7페이즈 상태기계를 얹었다. plan.stance = 현재 페이즈 라벨.
    EXPAND → MASS → TOUR → GATHER → (DEFEND) → CONSOL → PUSH."""
    a = Actions()
    my_side = M.my_side
    if OM is None:
        OM = OpponentModel()
    if plan is None:
        plan = Plan()

    my_warriors     = [w for w in S.warriors if w.id.side is my_side]
    enemy_warriors  = [w for w in S.warriors if w.id.side is not my_side]
    enemy_regions   = {w.region for w in enemy_warriors}
    my_buildings    = {b.region: b for b in S.buildings if b.side is my_side}
    enemy_buildings = {b.region: b for b in S.buildings if b.side is not my_side}
    stronghold_set  = set(M.strongholds)

    OM.observe(turn, enemy_warriors, M.my_hq, M.opp_hq, P.dist)

    gold = S.gold
    built_this_turn: set[int] = set()
    wbr: dict[int, list[Warrior]] = {}
    for w in my_warriors:
        wbr.setdefault(w.region, []).append(w)

    def stat_at(r: int) -> list[Warrior]:
        return [w for w in wbr.get(r, []) if w.state is WState.STATIONARY]

    my_hq_b  = my_buildings.get(M.my_hq)
    opp_dist = max(1.0, P.dist[M.my_hq][M.opp_hq])
    total_warriors = len(my_warriors)
    upkeep = UPKEEP_PER_WARRIOR * total_warriors
    actual_income = sum(
        WORK_INCOME * min(len(stat_at(r)), b.work_cap())
        for r, b in my_buildings.items())

    # ── 페이즈 상태(Plan에 동적 부착: 게임 전체 지속) ───────────────────
    if not hasattr(plan, "phase"):
        plan.phase = "EXPAND"
        plan.tour_started = False
        plan.tour_ids = set()      # 원정대(id.num) — 사망시 자동 이탈
        plan.tour_angle = None     # 마지막 목표의 적HQ 기준 각(시계방향 순회용)
        plan.hot_until = 0         # DEFEND 해제 히스테리시스
        plan.tour_wait_since = 0   # 편성 시작 턴(대기/포기 판정 기준)
        plan.tour_soft_only = False  # 재원정: 무른 기지만 목표
        plan.tour_done_turn = -999   # 마지막 원정 종료 턴(재원정 쿨다운 기준)
        plan.push_launched = False   # 총공세 선발대 발진 여부(소요 병력 홀드)
        plan.sortie_ids = set()      # 출격대(id.num) — t150+ 기지 가리슨 출격
        plan.sortie_target = None    # 출격 목표(적 기지)
        plan.sortie_home = None      # 원대(복귀 기지)
        plan.sortie_since = 0        # 출격 시작 턴(교착 판정)
        plan.re_expand_until = 0     # 재확장 창 종료 턴(0 = 첫 확장/미발동)
        plan.enemy_toured = False    # 상대 원정 발진 감지(래치 — 한번 켜지면 유지)
        plan.push_since = 0          # 총공세 발진 턴(조기 총공세 실패 판정용)
        plan.push_hq_hp0 = 0         # 발진 시점 적 HQ HP(공성 성과 판정 기준)
        plan.peak_bases = 0          # 이번 판 최대 기지 수(잠식 감지 기준)

    orders: dict[WarriorId, int] = {}

    # ── 공통 관측: HQ로 오는 적 / 대규모 공격 / HQ 함락 추정(2패스) ──────
    hq_incoming = [e for e in enemy_warriors
                   if P.dist[e.region][M.my_hq] <= opp_dist * 0.70]
    big_attack = OM.advancing >= 3 and len(hq_incoming) >= 6
    # '실제 위협'(2026-07-04, 실전 8(1).txt): 0.70 반경은 맵 중앙의 적 기지
    # 가리슨(상주·비전진)까지 포함한다 — 경계 연장과 방어 양산은 이 기준이
    # 아니라 실위협(대공세 / HQ 3홉 내 3+ / 반경 내 전진 무리)으로만.
    near3 = sum(1 for e in enemy_warriors
                if P.hops[e.region][M.my_hq] <= 3)
    real_threat = (big_attack or near3 >= 3
                   or (OM.advancing >= 2 and len(hq_incoming) >= 3))
    # 상대 원정 발진 감지(사용자 지정, 2026-07-04): 5명 이상이 동시에 우리
    # 쪽으로 전진 = 스택 발진(정찰·정착민 1~2명은 미달). 카운터 원정 트리거.
    if OM.advancing >= 5:
        plan.enemy_toured = True
    hq_falls_in = math.inf
    if my_hq_b and len(hq_incoming) >= 4:
        my_turret = HQ_LEVELS[my_hq_b.level].turret
        wave_eta = min(P.hops[e.region][M.my_hq] for e in hq_incoming)

        def _home_by(w: Warrior, deadline: float) -> bool:
            if w.region == M.opp_hq:
                return False
            if w.state is WState.MOVING and w.target != M.my_hq:
                return False
            return P.hops[w.region][M.my_hq] <= deadline

        d0 = sum(1 for w in my_warriors if _home_by(w, wave_eta))
        net = len(hq_incoming) - d0 - my_turret
        if net > 0:
            falls0 = wave_eta + math.ceil(my_hq_b.hp / net)
            d1 = sum(1 for w in my_warriors if _home_by(w, falls0))
            net = len(hq_incoming) - d1 - my_turret
            if net > 0:
                hq_falls_in = wave_eta + math.ceil(my_hq_b.hp / net)

    # ── 저자산 안전 비축(사용자 지정, 2026-07-05, 실전 75559 기반 1차) ────
    # 공격할 자산이 모자라고 + 상대가 지금 공격해 오지 않고 + 기지 수가
    # 충분하면(맵 크기 연동, 보통 4개) 원정·카운터 원정·재원정으로 새지
    # 않고 GATHER에서 자산을 모은다. '자산' = 편성 창(TOUR_FORM_WAIT) 안에
    # 최소 원정대(6명)를 채울 수 있는가 — 현재 HQ 여유 병력 + 잔고·순수입
    # 으로 살 수 있는 신병 수(편성 기계와 동일 기준). 조기 총공세는 자체
    # 승산 검사(avail≥need+2)가 있으므로 이 게이트의 대상이 아니다.
    n_bases_b = sum(1 for _r, b in my_buildings.items()
                    if b.type is not BType.HQ)
    plan.peak_bases = max(plan.peak_bases, n_bases_b)
    # 경제 위기 판정(사용자 승인 2026-07-05, 실전 1.txt류 6판): 기지 2개 이상
    # 상실(peak 대비)도 위기로 — 기존 정의(기지 ≤1)는 거의 다 무너진 뒤에야
    # 발동해 대응 시간이 없었다(1.txt: 기지 5개가 t103~122에 하나씩 붕괴,
    # 수입<유지비 아사 소용돌이). 수입 위기·기지 ≤1 정의는 기존 유지.
    eco_crisis_b = (n_bases_b <= 1
                    or actual_income < upkeep + 30
                    or n_bases_b <= plan.peak_bases - 2)
    # 전투력 계수(사용자 승인 2026-07-05, 실전 6판: 우리 L1 4HP vs 상대
    # L2~L4 5~7HP — 머릿수 동수 비교는 과대평가). 신병 체력은 HQ 레벨을
    # 따르므로(4/5/6/7/8) 승산·소요 비교에서 적 1명을 (적 신병HP/우리
    # 신병HP)명으로 환산. 레벨 동률 = 1.0(기존 동작 그대로). 적용은 공격
    # 계열만(총공세 소요·조기 총공세·원정/출격 승산·레이스 얇음) — 함락
    # 추정(방어)은 사용자 결정으로 제외(공성 상쇄는 머릿수 규칙 + 총동원·
    # 발진 보류·위기 해제 차단의 오경보 파급).
    ohb_p = enemy_buildings.get(M.opp_hq)
    pow_r = (HQ_LEVELS[ohb_p.level if ohb_p else 1].warrior_hp
             / HQ_LEVELS[my_hq_b.level if my_hq_b else 1].warrior_hp)
    spare_b = max(0, len(stat_at(M.my_hq))
                  - (my_hq_b.work_cap() if my_hq_b else 1))
    fieldable = spare_b + (gold + max(0, actual_income - upkeep)
                           * TOUR_FORM_WAIT) // TRAIN_COST
    bank_up = (not real_threat
               and fieldable < min(6, TOUR_SIZE)
               and n_bases_b >= min(4, max(2, len(M.strongholds) // 3)))

    # ── 종반 전환 판단(사용자 승인 2026-07-05, 시뮬 5.txt — 75559 리셋으로
    # 빠졌다가 재발해 재이식 2026-07-06: 모델 봇이 같은 맵에서 L3 vs L4
    # 티어브레이크 패배). 자산 비관측 상대는 부자 가정(레벨 캡×ETA 서지)으로
    # '깰 수 있는가'를 평가, 마감까지 최대 가용으로도 못 깨면 골드를 훈련
    # 대신 HQ 업글로(티어브레이크 = HQ 잔여 HP). 골드 우선순위 계층이라
    # 모델 봇의 페이즈 오버라이드 아래에서도 그대로 작동한다.
    plan.push_hopeless = False
    if (turn >= T_CONSOL and ohb_p is not None and my_hq_b is not None
            and ohb_p.level > my_hq_b.level):
        # 발동 전제(2026-07-06 조임 2차): 레벨 열세일 때만 — 티어브레이크를
        # 이미 지고 있는 상황의 만회 수. 동레벨 발동(ETA 조건 포함)은 대형
        # 미러 맵 종반에서 총공세 병력을 깎아 회귀(A/B 미러 −7/−4 실측).
        # 5.txt류(우리 L3 vs 상대 L4 터틀)는 레벨 열세로 정확히 잡힌다.
        eta_h = P.hops[M.my_hq][M.opp_hq]
        horizon_h = max(0, MAX_TURN - eta_h - 3 - turn)   # 발진 마감까지
        need_hard = (sum(1 for e in enemy_warriors
                         if P.hops[e.region][M.opp_hq] <= 2)
                     + HQ_LEVELS[ohb_p.level].turret
                     + HQ_LEVELS[ohb_p.level].train_cap * eta_h)
        afford_h = (gold + max(0, actual_income - upkeep) * horizon_h
                    ) // TRAIN_COST
        our_max = (len(stat_at(M.my_hq))
                   + min(HQ_LEVELS[my_hq_b.level].train_cap * horizon_h,
                         afford_h))
        plan.push_hopeless = our_max < need_hard

    # ── 페이즈 전이(시간 → 원정 진행 → 공격/해소 → 총공세 순서로 판정) ───
    if plan.phase == "EXPAND" and turn >= T_MASS_START:
        if plan.re_expand_until > 0:
            # 재확장 창(사용자 지정, 2026-07-04): 경제가 회복됐거나(건물 3+ &
            # 수입이 유지비+30 이상) 창이 끝나면 정비로 복귀. 첫 확장(0)과 달리
            # MASS/TOUR로는 가지 않는다 — 재확장의 목적은 경제 복구뿐.
            if (turn > plan.re_expand_until
                    or (len(my_buildings) >= 3
                        and actual_income >= upkeep + 30)):
                plan.phase = "GATHER"
        else:
            plan.phase = "MASS"
    # 카운터 원정(사용자 지정, 2026-07-04): 상대가 원정을 나가면 상대 본토가
    # 비는 시점 — t60을 기다리지 않고 맞원정으로 경제를 맞교환한다. 상대
    # 원정이 우리 본부를 노리면 어차피 big_attack이 TOUR→DEFEND로 전환(선방
    # 어 후 역습 — 8.txt에서 실증된 흐름)하므로 안전.
    # 정밀 조기방어(2026-07-07): EXPAND 중 HQ 함락이 '실제로 계산'되면(적 4+
    # 웨이브가 HQ로 진격해 함락 ETA 유한) 즉시 DEFEND — 확장페이즈 방어전환이
    # t30 게이트라 t14 러시(22368류)에 무방비이던 구멍. big_attack(적진 가리슨
    # 오탐)보다 정밀: hq_falls_in 유한 = 봇 자체 함락계산이라 오발 최소.
    if plan.phase == "EXPAND" and hq_falls_in != math.inf:
        plan.phase = "DEFEND"
        plan.hot_until = turn + 3
    if (plan.phase == "EXPAND" and plan.enemy_toured
            and plan.re_expand_until == 0 and turn >= 30
            and not bank_up):
        plan.phase = "TOUR"
        plan.tour_wait_since = turn
    if plan.phase == "MASS" and (turn >= T_TOUR_START or plan.enemy_toured):
        if bank_up:
            plan.phase = "GATHER"      # 저자산 비축: 원정 대신 자산부터
        else:
            plan.phase = "TOUR"
            plan.tour_wait_since = turn

    def _push_race_ok(force: int, need: int, ohb_x) -> bool:
        # 통합 커밋 결정 seam(S2 2026-07-06, SC8_META): 조기올인·맞바꾸기
        # 레이스 두 진입점이 공통 호출하는 "지금 데스볼 커밋?" 판정점.
        # ⚠ 손튜닝 일방 휴리스틱은 실측 regression으로 폐기(이기는 커밋 차단→
        #   비축군 아사). 커밋은 '커밋 vs 대기' 비교 문제라 **양쪽 룩어헤드**가
        #   필수 — 추상 포워드모델로 두 매크로를 K턴 투영·비교(argmax).
        # FSM 임계가 이미 '커밋 가능'이라 판단한 뒤 호출되므로 이 게이트는
        # '아사·역전패 커밋'만 veto하는 2차 필터 — True 반환은 배포동작 불변.
        if ohb_x is None or my_hq_b is None:
            return True                      # 관측 부족 → 기존 임계 그대로 통과
        eta = P.hops[M.my_hq][M.opp_hq]
        if not (0 < eta < 90):
            return True
        # 커밋 sticky(2026-07-06, 리그 A/B 회귀 수정): 이미 커밋한 공격은
        # 진군창(eta) 동안 재평가로 중단하지 않는다. 봇의 push-abort가 PUSH를
        # GATHER로 되돌린 뒤 seam이 재커밋을 veto하면 비축군이 8턴 놀다 좌초
        # (current 시드18 무→패 stop-start; 원래 lesson "커밋 차단→비축 아사").
        # 게임이론상 반쯤 커밋이 최악 → 최초 커밋만 룩어헤드가 게이트하고,
        # 최근 커밋 뒤에는 낙관 유지(공격을 끝까지 밀어붙인다).
        _sc = getattr(plan, "seam_commit_turn", -999)
        if 0 <= turn - _sc <= eta:
            return True
        o_def = sum(1 for e in enemy_warriors
                    if P.hops[e.region][M.opp_hq] <= 2)
        # 상대 '내 HQ 임박' 웨이브만(hops≤3) 카운트. ⚠ 실전 검증(시드3): 대형
        # 맵에서 내 반구의 적 대부분은 '기지 사냥꾼'이라 내 HQ에 도달·공성하지
        # 못한다 — 이들을 HQ 공성 스택으로 모델링하면 내 HQ 함락을 오예측해
        # '이기는 커밋'을 veto(회귀). 스칼라 모델은 기지파괴 공간역학을 못 담으
        # 므로 doorstep(≤3홉) 실위협만 반영하고, 커밋 veto의 주근거는 아사·
        # HQ공략가능성에 둔다. (기지 사냥은 아래 wcap 잠식으로 간접 반영.)
        o_raid = [e for e in enemy_warriors
                  if P.hops[e.region][M.my_hq] <= 3]
        st = _MState.__new__(_MState)
        st.m_gold    = float(S.gold)
        # 전 병력을 home HP풀로(커밋분은 룩어헤드가 away로 분리).
        st.m_home_hp = float(total_warriors * _whp(my_hq_b.level))
        st.m_away_hp = 0.0
        st.m_march   = -1
        st.m_hqlvl   = my_hq_b.level
        st.m_hqhp    = float(my_hq_b.hp)
        st.m_wcap    = sum(b.work_cap() for b in my_buildings.values())
        st.m_tcap    = _tcap(my_hq_b.level)  # 내 증원 = 훈련캡(gold 제한)
        # ⚠ 낙관 편향(설계): veto는 커밋을 '제거만' 하므로 커밋 롤아웃을 낙관
        # 편향해 명백한 패자(내 일꾼 재배치 아사·현시점 두꺼운 벽)만 걸러야
        # 승자를 안 죽인다(비관=회귀). seam 발동 전제=상대 HQ 얇음=상대군
        # forward 커밋 → 진군 동안 상대 HQ 증원 안 함으로 본다(o_tcap=0).
        st.o_tcap    = 0
        st.o_gold    = float(START_GOLD)     # 상대 잔고 미관측 → 중립 가정(리그로 보정)
        st.o_home_hp = float(o_def * _whp(ohb_x.level))
        st.o_away_hp = float(len(o_raid) * _whp(ohb_x.level))
        st.o_march   = (min(P.hops[e.region][M.my_hq] for e in o_raid)
                        if o_raid else -1)
        st.o_hqlvl   = ohb_x.level
        st.o_hqhp    = float(ohb_x.hp)
        st.o_wcap    = st.m_wcap              # 상대 경제 미관측 → 대칭 가정
        _ok = _macro_commit_better(st, force, eta)
        if _ok:
            plan.seam_commit_turn = turn       # 커밋 sticky 마커(위 진군창 유지)
        return _ok

    # ── 맞바꾸기 레이스(사용자 지정, 2026-07-04, 실전 8(4).txt) ──────────
    # 상대가 대군을 몰고 우리 반구로 공격하러 오는데 상대 본부가 얇으면,
    # 방어 대신 우리 기동병력(HQ 비축+원정대)을 즉시 적 본부로 돌진 —
    # 상대는 기지 사냥 경로라 회군이 늦고, 본부 파괴는 즉승. 가리슨과 HQ
    # 경비(레벨 수)는 남겨 홈 생존 시간을 번다. 중간 충돌·양패 리스크는
    # 사용자 수용(로그로 사후 검증). 실패시 조기 총공세 복귀 규칙이 회수.
    if plan.phase in ("MASS", "TOUR", "GATHER") and turn < T_FINAL:
        raiders = sum(1 for e in enemy_warriors
                      if P.dist[e.region][M.my_hq]
                      < P.dist[e.region][M.opp_hq])
        if big_attack or (OM.advancing >= 5 and raiders >= 5):
            guard_n = my_hq_b.level if my_hq_b else 1
            mobile = (max(0, len(stat_at(M.my_hq)) - guard_n)
                      + sum(1 for w in my_warriors
                            if w.id.num in plan.tour_ids
                            and w.region != M.my_hq))
            ohb_r = enemy_buildings.get(M.opp_hq)
            thin = (math.ceil(sum(1 for e in enemy_warriors
                                  if P.hops[e.region][M.opp_hq] <= 2)
                              * pow_r)
                    + (HQ_LEVELS[ohb_r.level].turret if ohb_r else 0))
            if (mobile >= 8 and mobile > thin
                    and (not META_UTIL or _push_race_ok(mobile, thin, ohb_r))):
                if plan.phase == "TOUR":
                    plan.tour_done_turn = turn
                plan.phase = "PUSH"
                plan.push_launched = True
                plan.push_since = turn
                plan.push_hq_hp0 = ohb_r.hp if ohb_r else 0
                for w in sorted(stat_at(M.my_hq),
                                key=lambda w: w.id.num)[guard_n:]:
                    orders[w.id] = M.opp_hq
                for w in my_warriors:          # 원정대도 즉시 목표 전환
                    if (w.id.num in plan.tour_ids
                            and w.state is WState.STATIONARY
                            and w.region not in (M.my_hq, M.opp_hq)):
                        orders[w.id] = M.opp_hq

    if plan.phase == "TOUR" and big_attack:
        # 원정(편성 포함) 중 대규모 공격 → 원정 중단·방어 전환. 단, 적 웨이브
        # 보다 귀환이 먼(=어차피 늦은) 원정대원은 소환 대신 적 본부로 돌진
        # (사용자 지정, 2026-07-03: 맞바꾸기 레이스 — 헛걸음 왕복 방지).
        plan.phase = "DEFEND"
        plan.hot_until = turn + 3
        plan.tour_done_turn = turn
        wave_eta = (min(P.hops[e.region][M.my_hq] for e in hq_incoming)
                    if hq_incoming else 0)
        for w in my_warriors:
            if (w.id.num in plan.tour_ids
                    and w.state is WState.STATIONARY
                    and w.region != M.my_hq):
                if P.hops[w.region][M.my_hq] > wave_eta:
                    orders[w.id] = M.opp_hq
                else:
                    orders[w.id] = M.my_hq
    elif plan.phase == "TOUR":
        # 재원정(soft_only)은 '무른 기지'(L≤2 & 수비≤2)만 목표 — 굳은 기지에
        # 원정대를 갈아 넣는 왕복 방지(사용자 조건의 미러). 첫 원정은 전 기지.
        n_squad = len(plan.tour_ids) if plan.tour_ids else TOUR_SIZE

        def _tour_ok(r: int, eb: Building) -> bool:
            # 원정 승산 검사(2026-07-04, 실전 1(5)·1(8) 실증: 수비 10+ 요새로
            # 직행한 원정대 12명 전멸 → 중반 군사력 0 → 이후 침공 무저항).
            # 출격과 같은 기준: 백병·포탑 우위 + 공성 6턴 내 격파 가능한
            # 목표만 순회. 승산 있는 목표가 하나도 없으면 귀환(완료 처리).
            dfn = sum(1 for e in enemy_warriors if e.region == r)
            # 백병 우위는 전투력 환산(pow_r), 공성 속도는 머릿수 규칙 그대로
            if n_squad < math.ceil(dfn * pow_r) + BASE_LEVELS[eb.level].turret + 2:
                return False
            return math.ceil(eb.hp / max(1, n_squad - dfn)) <= 6

        enemy_base_list = [
            r for r, b in enemy_buildings.items()
            if b.type is not BType.HQ
            and (not plan.tour_soft_only
                 or (b.level <= 2
                     and sum(1 for e in enemy_warriors
                             if e.region == r) <= 2))
            and _tour_ok(r, b)]

        def _ang(r: int) -> float:
            return math.atan2(M.y[r] - M.y[M.opp_hq], M.x[r] - M.x[M.opp_hq])

        if not plan.tour_started:
            # 발대: HQ 워커(work_cap)를 남기고 비축 병력에서 12명 편성.
            # 12명이 아직 안 모였으면 아래 TRAIN(풀캡)으로 채우며 대기.
            at_hq = sorted(stat_at(M.my_hq), key=lambda w: w.id.num)
            keep = my_hq_b.work_cap() if my_hq_b else 1
            cand = at_hq[keep:]
            waited = turn - plan.tour_wait_since
            if (len(cand) >= TOUR_SIZE
                    or (waited >= TOUR_FORM_WAIT and len(cand) >= 6)):
                plan.tour_ids = {w.id.num for w in cand[-TOUR_SIZE:]}
                plan.tour_started = True
            elif waited >= TOUR_FORM_ABORT:
                plan.phase = "GATHER"          # 편성 실패(전사 부족) → 정비로
                plan.tour_done_turn = turn
        if plan.tour_started:
            plan.tour_ids &= {w.id.num for w in my_warriors}
            if not plan.tour_ids:
                plan.phase = "GATHER"          # 원정대 전멸 → 정비로
                plan.tour_done_turn = turn
            elif (not enemy_base_list
                  or turn >= (RETOUR_END if plan.tour_soft_only else 165)):
                # 임무 완료(목표 기지 전멸) 또는 시간 안전장치 → 본부 귀환
                # (재원정은 사용자 지정대로 150에 무조건 접는다)
                plan.phase = "GATHER"
                plan.tour_done_turn = turn
                for w in my_warriors:
                    if (w.id.num in plan.tour_ids
                            and w.state is WState.STATIONARY
                            and w.region != M.my_hq):
                        orders[w.id] = M.my_hq
            else:
                # 목표 갱신: 파괴됨(또는 교착 30턴) → 시계방향 다음 기지.
                # 첫 목표는 우리 HQ에서 홉 최근접, 이후는 적HQ 기준 각도가
                # 시계방향으로 가장 가까운 기지(중간에 새로 지어진 기지도
                # enemy_base_list가 매턴 갱신되므로 순회에 자연 편입).
                if (plan.wave_target not in enemy_buildings
                        or plan.wave_target not in enemy_base_list
                        or turn - plan.wave_since > TOUR_STALL):
                    if plan.tour_angle is None:
                        tgt = min(enemy_base_list,
                                  key=lambda r: P.hops[M.my_hq][r])
                    else:
                        two_pi = 2 * math.pi
                        a0 = plan.tour_angle

                        def _cw(r: int) -> float:
                            d = (a0 - _ang(r)) % two_pi
                            return d if d > 1e-9 else two_pi

                        cands = ([r for r in enemy_base_list
                                  if r != plan.wave_target]
                                 or enemy_base_list)
                        tgt = min(cands, key=_cw)
                    plan.wave_target = tgt
                    plan.tour_angle = _ang(tgt)
                    plan.wave_since = turn
                for w in my_warriors:
                    if (w.id.num in plan.tour_ids
                            and w.state is WState.STATIONARY
                            and w.region != plan.wave_target):
                        orders[w.id] = plan.wave_target

    if plan.phase == "GATHER":
        eco_crisis = eco_crisis_b          # 상단 공통 판정(잠식 포함) 재사용
        soft_bases = sum(1 for r, b in enemy_buildings.items()
                         if b.type is not BType.HQ and b.level <= 2
                         and sum(1 for e in enemy_warriors
                                 if e.region == r) <= 2)
        ohb = enemy_buildings.get(M.opp_hq)
        eta0 = P.hops[M.my_hq][M.opp_hq]
        e_cap0 = HQ_LEVELS[ohb.level].train_cap if ohb else 0
        need0 = (math.ceil(sum(1 for e in enemy_warriors
                               if P.hops[e.region][M.opp_hq] <= 2) * pow_r)
                 + (HQ_LEVELS[ohb.level].turret if ohb else 0)
                 + math.ceil(min(e_cap0, OM.train_rate) * eta0 * pow_r))
        avail0 = max(0, len(stat_at(M.my_hq))
                     - (my_hq_b.level if my_hq_b else 1))

        if big_attack and (hq_falls_in < math.inf or not eco_crisis):
            # 위기·본부 안전(함락 추정 없음)이면 대공세여도 DEFEND 재진입을
            # 막고 아래 경제 대응(재확장/위기 원정)을 연다 — 아니면 DEFEND
            # 해제(아래)와 이 재진입이 핑퐁하며 잠금이 유지된다(실전 1.txt).
            plan.phase = "DEFEND"
            plan.hot_until = turn + 3
        elif turn >= T_CONSOL:
            plan.phase = "CONSOL"
        elif (turn >= T_TOUR_START and ohb is not None
              and avail0 >= need0 + 2
              and S.gold >= (avail0 + 2) * MOVE_COST
              and (not META_UTIL or _push_race_ok(avail0, need0, ohb))):
            # 조기 총공세(사용자 지정, 2026-07-04, 실험적 — 역효과 시 제거
            # 예정): 상대 본부가 얇으면(수비+포탑+도착까지 증원여지, 여유 2)
            # t180을 기다리지 않고 홈 비축으로 즉시 결행. 소요-홀드·후속·HQ
            # 잔류는 PUSH 기계를 그대로 쓰고, 실패하면 아래 복귀 규칙이 회수.
            plan.phase = "PUSH"
        elif (turn < 150
              and turn > plan.re_expand_until + 10
              and eco_crisis
              and gold >= BASE_LEVELS[1].cost
              and any(r not in my_buildings and r not in enemy_buildings
                      and r not in enemy_regions
                      for r in M.strongholds)):
            # 재확장(사용자 지정, 2026-07-04): 경제 위기(기지 ≤1 또는 수입이
            # 훈련 가드선 미달)면 EXPAND를 한 번 더 — HQ 잉여 병력을 정착민
            # 으로 재파견. 단 '지금 지을 돈(300)이 있을 때만'(8(2).txt:
            # 파산 상태 파견은 빈손 대기만 시킴) — 없으면 아래 위기 원정으로.
            plan.phase = "EXPAND"
            plan.re_expand_until = turn + 25
        elif (not bank_up             # 저자산 안전 비축(2026-07-05)이 우선
              and turn - plan.tour_done_turn >= TOUR_COOLDOWN
              and turn < RETOUR_LAST
              and (S.gold >= 600
                   or (eco_crisis and S.gold >= 60
                       and fieldable >= min(6, TOUR_SIZE)))
              and soft_bases >= (1 if eco_crisis else RETOUR_SOFT)):
            # 재원정 + 위기 원정(사용자 지정, 2026-07-04, 8(2).txt): 평시엔
            # 잔고 600·무른 기지 2개 이상일 때만. 경제 위기에 건설비도 없으면
            # 상대의 무른 기지를 맞파괴("너도 경제 망해라") — 무른 기지 1개만
            # 있어도 발진. 위기 원정 규모 게이트는 비축 게이트와 동일 기준
            # (편성 창 내 최소 원정대 충원 가능 — 2026-07-05 통일). 부순 거점
            # 위 건설은 BUILD(선 자리 건설)가 자동으로 처리.
            plan.phase = "TOUR"
            plan.tour_started = False
            plan.tour_ids = set()
            plan.tour_angle = None
            plan.wave_target = None
            plan.tour_wait_since = turn
            plan.tour_soft_only = True
    if plan.phase == "DEFEND":
        # 위협 지속 판정: 상주 가리슨이 경계를 인질 잡던 버그(8(1).txt:
        # t64~180 통째로 DEFEND에 소모)의 수정 — 실위협만 경계를 연장.
        if real_threat:
            plan.hot_until = turn + 3
        if turn > plan.hot_until:
            # 해소 → t170 전이면 GATHER 복귀(2026-07-04, 실전 8.txt: 조기
            # 공격 해소가 무조건 CONSOL로 가면서 재확장·재원정·기지업글·출격
            # 이 전부 잠김 — t75부터 125턴을 수입 30으로 앉아만 있다가 패배.
            # 정비는 원래 t170+ 페이즈다). t170 이후 해소만 CONSOL로.
            plan.phase = "CONSOL" if turn >= T_CONSOL else "GATHER"
        elif (eco_crisis_b and hq_falls_in == math.inf
              and turn < T_CONSOL):
            # 위기 잠금 해제(사용자 승인 2026-07-05, 실전 1.txt: 적이 기지
            # 위에 상주하며 하나씩 부수는 동안 real_threat이 매턴 연장 →
            # DEFEND에 갇혀 t103~140 명령이 TRAIN뿐, 재확장·위기 원정은
            # GATHER 전용이라 잠김 → 수입 붕괴·아사·본부 원샷). 본부 함락
            # 추정이 없을 때만 경계를 풀고 경제 대응을 연다.
            plan.phase = "GATHER"
    if plan.phase == "CONSOL" and big_attack and turn < T_FINAL:
        plan.phase = "DEFEND"                  # 정비 중 대공세 → 방어(대칭 보강)
        plan.hot_until = turn + 3
    if (plan.phase == "PUSH" and plan.push_launched
            and turn < T_FINAL and turn - plan.push_since > 3):
        # 조기 총공세 실패 복귀: t180 전 발진은 ① 공격대 소멸 또는(2026-07-04
        # 재추가, 실대결 4.txt 재발) ② 교착 — 도착 후 6턴간 적 HQ HP를 2도
        # 못 깎음(컨베이어는 파이프라인이 ①을 영영 못 띄우므로 성과 기준이
        # 필수) ③ 시간 초과(ETA+20턴)면 접고 정비로 복귀 — 조건이 다시
        # 차면 재시도. t180 이후는 T_FINAL 규칙이 지배(올인 유지).
        attackers = sum(1 for w in my_warriors
                        if P.hops[w.region][M.opp_hq] <= 3
                        or (w.state is WState.MOVING
                            and w.target == M.opp_hq))
        eta_r = P.hops[M.my_hq][M.opp_hq]
        elapsed = turn - plan.push_since
        ohb_r = enemy_buildings.get(M.opp_hq)
        dealt = plan.push_hq_hp0 - (ohb_r.hp if ohb_r else 0)
        if (attackers == 0
                or (elapsed >= eta_r + 6 and ohb_r is not None
                    and dealt <= 1)
                or elapsed >= eta_r + 20):
            plan.phase = "GATHER"
            plan.push_launched = False
    if turn >= T_FINAL and plan.phase != "PUSH":
        plan.phase = "PUSH"

    # ── 기지 가리슨 출격(사용자 지정, 2026-07-03): t150 이후 원정 대신,
    #    기지 전사들이 '이길 수 있는' 적 기지 하나를 부수고 원대 복귀(원대
    #    소실 시 HQ 복귀). 승산 = 머릿수 > 수비+포탑 & 4턴 내 공성 격파,
    #    왕복 시간·경로 안전까지 확인. 동시 출격은 1건(관리 단순화). ──────
    if plan.phase in ("GATHER", "CONSOL"):
        if plan.sortie_ids:
            plan.sortie_ids &= {w.id.num for w in my_warriors}
            if not plan.sortie_ids:
                plan.sortie_target = None      # 출격대 전멸
        if plan.sortie_ids:
            members = [w for w in my_warriors if w.id.num in plan.sortie_ids]
            if (plan.sortie_target in enemy_buildings
                    and turn - plan.sortie_since <= SORTIE_STALL):
                for w in members:
                    if (w.state is WState.STATIONARY
                            and w.region != plan.sortie_target):
                        orders[w.id] = plan.sortie_target
            else:
                # 목표 파괴(또는 교착) → 복귀. 전원 도착하면 출격 종료.
                dest = (plan.sortie_home
                        if plan.sortie_home in my_buildings else M.my_hq)
                back = True
                for w in members:
                    if w.region != dest:
                        back = False
                        if w.state is WState.STATIONARY:
                            orders[w.id] = dest
                if back:
                    plan.sortie_ids = set()
                    plan.sortie_target = None
        elif turn >= SORTIE_START:
            best = None
            for r, b in my_buildings.items():
                if r == M.my_hq or r in enemy_regions:
                    continue
                grp = stat_at(r)
                if len(grp) < 2:
                    continue
                n = len(grp)
                for e, eb in enemy_buildings.items():
                    if eb.type is BType.HQ:
                        continue
                    dfn = sum(1 for w in enemy_warriors if w.region == e)
                    if n < (math.ceil(dfn * pow_r)
                            + BASE_LEVELS[eb.level].turret + 1):
                        continue                 # 승산 없음(백병·공성 열세)
                    kill = math.ceil(eb.hp / max(1, n - dfn))
                    if kill > 4:
                        continue                 # 장기 공성은 포탑에 소모됨
                    h = P.hops[r][e]
                    if turn + 2 * h + kill > MAX_TURN - 5:
                        continue                 # 왕복 시간 부족
                    if any(rr in enemy_buildings or rr in enemy_regions
                           for rr in path(P, r, e)[1:-1]):
                        continue                 # 경로에 적 진지(헌납 방지)
                    if best is None or h < best[0]:
                        best = (h, r, e, grp)
            if best is not None:
                _, r, e, grp = best
                plan.sortie_ids = {w.id.num for w in grp}
                plan.sortie_target = e
                plan.sortie_home = r
                plan.sortie_since = turn
                for w in grp:
                    orders[w.id] = e
    else:
        plan.sortie_ids = set()                  # DEFEND/PUSH 등에선 해산
        plan.sortie_target = None

    # ── BUILD: 빈 거점 위에 이미 선 워커 → 건설(파견은 EXPAND만, 건설은
    #    현장 도착분 회수 차원에서 정비 전 페이즈까지 허용) ────────────────
    if plan.phase in ("EXPAND", "MASS", "TOUR", "GATHER"):
        for r, ws in wbr.items():
            if (r in stronghold_set
                    and r not in my_buildings
                    and r not in enemy_buildings
                    and r not in enemy_regions
                    and r not in built_this_turn
                    and any(w.state is WState.STATIONARY for w in ws)
                    and gold >= BASE_LEVELS[1].cost):
                a.upgrades.append(r)
                built_this_turn.add(r)
                gold -= BASE_LEVELS[1].cost

    # ── HQ L2 조기 확보(2026-07-04, 실전 9판 분석) ───────────────────────
    # 상대 전원이 t36~63에 첫 HQ 업글을 하는데 우리는 9판 중 8판을 L1로 마쳐
    # 턴한계 티어브레이크(HQ 레벨=최대HP) 전패 요인이 됐다. L2는 포탑 1→2,
    # HP 10→15로 중반 침공 방어에도 직결. 기지 건설 예비 300만 남으면 페이즈
    # 무관(정비 전) 실행.
    if (my_hq_b is not None and my_hq_b.level == 1
            and plan.phase in ("EXPAND", "MASS", "TOUR", "GATHER")
            and M.my_hq not in enemy_regions and stat_at(M.my_hq)
            and M.my_hq not in built_this_turn
            and gold >= HQ_LEVELS[2].upgrade_cost + BASE_LEVELS[1].cost):
        a.upgrades.append(M.my_hq)
        built_this_turn.add(M.my_hq)
        gold -= HQ_LEVELS[2].upgrade_cost

    # ── UPGRADE ──────────────────────────────────────────────────────────
    # GATHER: HQ 우선(포탑·훈련캡·최대HP — 방어와 총공세 준비), 다음 싼 기지.
    #   cost+2000 게이트라 잔고는 GOLD_TARGET을 향해 계속 우상향.
    #   ※ 사용자 스케줄엔 HQ 업글이 정비(170~)에만 있으나, HQ L1(포탑1·훈련
    #   1/턴)로는 '대규모 공격 방어'와 '엄청 훈련'이 물리적으로 불가라 GATHER
    #   부터 허용 — 보고서에 명시한 유일한 설계 보정.
    # CONSOL/PUSH: HQ만, 잔고 600 유지선에서.
    if plan.phase == "GATHER":
        opp_hq_bb = enemy_buildings.get(M.opp_hq)
        opp_hq_lv = opp_hq_bb.level if opp_hq_bb is not None else 1
        cand_b = []
        for r, b in my_buildings.items():
            mx = HQ_MAX_LEVEL if b.type is BType.HQ else BASE_MAX_LEVEL
            if (b.level >= mx or r in enemy_regions or not stat_at(r)
                    or r in built_this_turn):
                continue
            cand_b.append((b.type is not BType.HQ, b.upgrade_cost(), r))
        cand_b.sort()
        for is_base, cost, r in cand_b:
            # 상대 HQ 관측 연동(2026-07-04): 상대 HQ 레벨이 우리 이상이면
            # HQ 저축 게이트를 +2000 → +600으로 완화. 턴한계 티어브레이크는
            # HQ 레벨(=최대HP) 경쟁이라 열세 방치가 곧 패배(실전 4판 실증).
            gate = cost + 2000
            if (not is_base and my_hq_b is not None
                    and my_hq_b.level <= opp_hq_lv):
                gate = cost + 600
            if gold >= gate:
                a.upgrades.append(r)
                built_this_turn.add(r)
                gold -= cost
                break
    elif (plan.phase in ("CONSOL", "PUSH") and my_hq_b
          and my_hq_b.level < HQ_MAX_LEVEL
          and M.my_hq not in enemy_regions and stat_at(M.my_hq)):
        cost = my_hq_b.upgrade_cost()
        # 종반 전환(push_hopeless)이면 유지선(600) 없이 즉시 업글 — 업글이
        # 곧 승점(티어브레이크)이자 방어(포탑·HP·신병 HP)다.
        if gold >= cost + (0 if plan.push_hopeless else 600):
            a.upgrades.append(M.my_hq)
            built_this_turn.add(M.my_hq)
            gold -= cost

    # ── 확장 후보(EXPAND 전용): 빈 거점만 ────────────────────────────────
    claims_open: list[int] = []
    near_set: set[int] = set()
    if plan.phase == "EXPAND":
        near_strongholds = sorted(
            [r for r in M.strongholds
             if r not in my_buildings and r not in enemy_buildings
             and r not in enemy_regions],
            key=lambda r: P.dist[M.my_hq][r])
        near_set = set(near_strongholds)
        covered: set[int] = set()
        for w in my_warriors:
            if w.state is WState.MOVING and w.target in near_set:
                covered.add(w.target)
        for r in near_strongholds:
            if stat_at(r):
                covered.add(r)
        claims_open = [r for r in near_strongholds if r not in covered]

    # ── GATHER 가리슨 목표 부족분 — 훈련·배치 공용 ───────────────────────
    # 사용자 지정(2026-07-03): L1은 1~2명(=2), L2 이상은 레벨 수만큼.
    # (종전 3×레벨은 과잉 — 일자리 정원 초과분이 유지비만 태움. 레벨 수는
    # L2+에서 work_cap과 일치해 수입 슬롯도 정확히 채워진다.)
    def g_target(b: Building) -> int:
        # 사용자 지정(2026-07-03): 초반(t<120)엔 방어 겸해 L1도 2명, t120
        # 이후엔 '레벨 수 = work_cap'만 유지(초과분은 회수 → HQ 총공세 비축).
        # 최소 1명 보장 — 무인 기지는 매턴 15골드 손해(노동 공백).
        if turn >= 120:
            return max(1, b.level)
        return 2 if b.level <= 1 else b.level

    def route_clear(r: int) -> bool:
        # HQ→r 파견 경로에 적 건물·병력이 없어야 보충 파견(4(1).txt: 80행
        # 증원 A50~A52가 경로상 적 기지 66에서 t173~175 한 명씩 연속 전사 —
        # 죽어도 gap이 남아 다음 신병을 같은 길로 또 보내는 축차 헌납).
        return not any(rr in enemy_buildings or rr in enemy_regions
                       for rr in path(P, M.my_hq, r)[1:-1])

    # ※ CONSOL에서도 배치·회수는 계속 돈다(2026-07-03): 방어 총동원 뒤 정비로
    #   넘어가면 기지들이 게임 끝까지 무인으로 방치되던 구멍(전사 0명 기지).
    #   단 CONSOL 신규 파견은 총공세(T_FINAL) 전에 도착할 수 있을 때만.
    g_slots: list[int] = []
    g_short_total = 0
    if plan.phase in ("GATHER", "CONSOL"):
        for r, b in my_buildings.items():
            # 교전 중 기지 제외: 가리슨이 백병전으로 녹는 동안 gap이 매턴
            # 다시 벌어져 보충병을 계속 헌납 + 훈련이 은행을 잠식(4(1).txt:
            # 이 낭비로 HQ가 L1에 머물러 TURN_LIMIT 레벨 열세 패배).
            # 교전 기지는 포탑+잔존 가리슨에 맡기고, 뺏기면 재건이 정답.
            if r in enemy_regions:
                continue
            if r != M.my_hq and not route_clear(r):
                continue
            if plan.sortie_ids and r == plan.sortie_home:
                continue                       # 출격대가 복귀할 자리(이중 충원 방지)
            if (plan.phase == "CONSOL" and r != M.my_hq
                    and turn + P.hops[M.my_hq][r] > T_FINAL):
                continue                       # 총공세 전 도착 불가 → 푸시 병력 보존
            inc = sum(1 for w in my_warriors
                      if w.state is WState.MOVING and w.target == r)
            gap = g_target(b) - len(stat_at(r)) - inc
            if gap > 0:
                g_short_total += gap
                if r != M.my_hq:
                    g_slots.extend([r] * gap)

    # ── TRAIN(페이즈별 정책) ─────────────────────────────────────────────
    if my_hq_b and M.my_hq not in enemy_regions:
        cap = HQ_LEVELS[my_hq_b.level].train_cap
        n = 0
        if plan.phase == "EXPAND":
            # 확장 요원만: 일자리 정원 + 진행 중 확장 + 경비 2
            total_wc = sum(b.work_cap() for b in my_buildings.values())
            need = total_wc + min(3, len(claims_open)) + 2 - total_warriors
            n = min(cap, max(0, need),
                    max(0, gold - BASE_LEVELS[1].cost) // TRAIN_COST)
        elif plan.phase == "MASS" or (plan.phase == "TOUR"
                                      and not plan.tour_started):
            n = min(cap, max(0, gold - 40) // TRAIN_COST)   # 비축: 풀캡
        elif plan.phase == "TOUR":
            slot_gap = sum(max(0, b.work_cap() - len(stat_at(r)))
                           for r, b in my_buildings.items())
            n = min(cap, slot_gap,
                    max(0, gold - BASE_LEVELS[1].cost) // TRAIN_COST)
        elif plan.phase == "GATHER":
            if actual_income >= upkeep + 30:                # 아사 가드
                n = min(cap, g_short_total,
                        max(0, gold - 600) // TRAIN_COST)
        elif plan.phase == "DEFEND":
            # 전력 양산 — 단 실위협일 때만(2026-07-04: 격퇴 후 잔여 경계턴과
            # 원거리 상주 가리슨에 반응해 재확장 종잣돈을 태우던 누수 차단).
            if real_threat:
                n = min(cap, max(0, gold - 40) // TRAIN_COST)
        elif plan.phase == "CONSOL":
            n = min(cap, max(0, gold - 600) // TRAIN_COST)  # 잔고 600 유지
        else:                                               # PUSH
            # 소요 병력(적 수비+포탑+증원 여지) 달성이 우선 — 아사 가드와
            # 발진 이동비(적진 이동 10/명)만 남기고 전액 훈련(사용자 지정).
            move_budget = MOVE_COST * len(stat_at(M.my_hq))
            n = min(cap, max(0, gold - max(40, upkeep * 2) - move_budget)
                    // TRAIN_COST)
        if (plan.push_hopeless and plan.phase in ("CONSOL", "PUSH")
                and my_hq_b.level < HQ_MAX_LEVEL):
            # 종반 전환: 다음 HQ 업글비를 예약하고 남는 골드만 훈련(5.txt:
            # 못 깰 목표에 종반 훈련을 태우는 동안 HQ가 L3에 머물러 레벨
            # 티어브레이크 패배 — 예약이면 L4~L5 도달).
            n = min(n, max(0, gold - my_hq_b.upgrade_cost()) // TRAIN_COST)
        # 아사 가드(2026-07-04, 실전 5판 실증: 기지가 압연당해 수입이 무너진
        # 상태에서 양산을 계속 → 유지비 미납 → 전군이 매턴 1씩 굶는 죽음의
        # 소용돌이 — 1(6)에선 22명 동시 아사 후 본부 함락). 훈련 후에도
        # (수입 ≥ 유지비) 또는 (잔고 ≥ 유지비 5턴분)을 만족해야 한다.
        while n > 0:
            up_after = UPKEEP_PER_WARRIOR * (total_warriors + n)
            if (actual_income >= up_after
                    or gold - TRAIN_COST * n >= up_after * 5):
                break
            n -= 1
        if n > 0:
            a.train_n = n
            gold -= TRAIN_COST * n

    # ── MOVE(페이즈별; TOUR는 위에서 이미 발령) ──────────────────────────
    if plan.phase == "EXPAND":
        garrisoned: set[WarriorId] = set()
        for r in set(my_buildings) | built_this_turn:
            b = my_buildings.get(r)
            wc = b.work_cap() if b else BASE_LEVELS[1].work_cap
            for w in sorted(stat_at(r), key=lambda w: w.id.num)[:wc]:
                garrisoned.add(w.id)
        for r in near_set:
            ws = sorted(stat_at(r), key=lambda w: w.id.num)
            if ws:
                garrisoned.add(ws[0].id)       # 건설비 모일 때까지 거점 대기
        pool = sorted(
            [w for w in my_warriors
             if w.state is WState.STATIONARY
             and w.region != M.opp_hq
             and w.id not in garrisoned
             and w.region not in enemy_regions],
            key=lambda w: w.id.num)
        # 파견 게이트는 이동비만(2026-07-04): 종전 '건설비 300 확보시' 게이트는
        # 회복기(방어가 은행을 40까지 소진)에 정착민 출발 자체를 막아 교착 —
        # 정착민은 거점에서 대기하다 골드가 모이면 짓는 구조라 조기 출발이 이득.
        if gold >= MOVE_COST:
            dispatch_pool = pool
            if turn <= GUARD_TURNS:
                hq_pool = [w for w in pool if w.region == M.my_hq]
                if hq_pool:
                    dispatch_pool = [w for w in pool if w.id != hq_pool[0].id]
            safe_slots: list[int] = []
            for r in claims_open:
                if not dispatch_pool:
                    break
                our = min(P.hops[w.region][r] for w in dispatch_pool)
                ene_w = min((P.hops[e.region][r] for e in enemy_warriors),
                            default=math.inf)
                if our <= min(ene_w, P.hops[M.opp_hq][r] + 1):
                    safe_slots.append(r)
            orders.update(_greedy_assign(dispatch_pool, safe_slots, P.dist))
        for w in pool:                          # 방황 방지: 잉여는 HQ 집결
            if (w.id not in orders and w.region not in my_buildings
                    and w.region not in near_set):
                orders[w.id] = M.my_hq
    elif plan.phase in ("GATHER", "CONSOL"):
        # HQ 잉여(가리슨 목표 초과분)를 부족한 기지로 배치 — 귀환한 원정대도
        # HQ 도착 후 이 경로로 재배치된다. CONSOL도 동일(무인 기지 방지).
        if my_hq_b and g_slots:
            at_hq = sorted(stat_at(M.my_hq), key=lambda w: w.id.num)
            surplus = at_hq[g_target(my_hq_b):]
            orders.update(_greedy_assign(surplus, g_slots, P.dist))
        # 목표 초과 주둔분은 HQ로 회수 — 배치는 '채우기만' 해서, 원정 낙오병
        # 등이 기지에 눌러앉으면 영구 잔류하던 문제(레벨보다 많은 가리슨).
        # 귀환 경로가 위험하면 그냥 둔다(가리슨 초과가 행군 헌납보다 낫다).
        for r, b in my_buildings.items():
            if r == M.my_hq or r in enemy_regions or not route_clear(r):
                continue
            ws = sorted(stat_at(r), key=lambda w: w.id.num)
            for w in ws[g_target(b):]:
                if w.id not in orders:
                    orders[w.id] = M.my_hq
        for w in my_warriors:                   # 낙오병(비건물 지역) 귀환
            if (w.state is WState.STATIONARY and w.id not in orders
                    and w.id.num not in plan.sortie_ids
                    and w.region not in my_buildings and w.region != M.opp_hq):
                orders[w.id] = M.my_hq
    elif plan.phase == "DEFEND":
        # 가리슨·신병 부동, 낙오병 귀환. 단 방어 중 적 웨이브보다 먼 낙오병은
        # 귀환해도 늦으므로 적 본부 레이스(원정대 중단 규칙과 동일 기준).
        wave_eta = (min(P.hops[e.region][M.my_hq] for e in hq_incoming)
                    if hq_incoming else math.inf)
        for w in my_warriors:
            if w.id.num in plan.sortie_ids or w.id in orders:
                continue                        # 출격대는 출격 블록이 지휘
            if (w.state is WState.STATIONARY
                    and w.region not in my_buildings and w.region != M.opp_hq):
                if P.hops[w.region][M.my_hq] > wave_eta:
                    orders[w.id] = M.opp_hq
                else:
                    orders[w.id] = M.my_hq
    elif plan.phase == "PUSH":
        # 대량 선발 + 소량 후속: 선발대는 '소요 병력' 이상 모일 때까지 홀드
        # (사용자 지정, 2026-07-03: 부족한 선발대는 L5 포탑에 헌납일 뿐).
        # 소요 병력 = 적 HQ·근처(2홉) 수비 + 포탑 + 도착까지 상대가 더 뽑을
        # 수 있는 병력(훈련캡×ETA, 상대 자산은 관측 불가라 훈련캡이 상한).
        # 단 발진 마감(도착+공성 3턴 역산)이 오면 모인 만큼이라도 발진.
        # 발진 후엔 기존대로 매턴 신규 훈련분이 소량 후속(27 → 22, 3, 2 …).
        # HQ 함락 추정이 뜨면 이번 턴 발진은 보류(방어 우선).
        if hq_falls_in == math.inf:
            guard = my_hq_b.level if my_hq_b else 3
            at_hq = sorted(stat_at(M.my_hq), key=lambda w: w.id.num)
            avail = at_hq[guard:]
            if not plan.push_launched:
                eta = P.hops[M.my_hq][M.opp_hq]
                opp_hq_b = enemy_buildings.get(M.opp_hq)
                e_turret = HQ_LEVELS[opp_hq_b.level].turret if opp_hq_b else 0
                e_cap = HQ_LEVELS[opp_hq_b.level].train_cap if opp_hq_b else 0
                near_def = sum(1 for e in enemy_warriors
                               if P.hops[e.region][M.opp_hq] <= 2)
                # 증원 여지 = 관측 훈련 속도×ETA(캡 상한). 캡×ETA 고정은
                # 과대추정(8(5).txt: 실측 0.3/턴인데 캡 2로 소요 26 산출 →
                # 마감 홀드 → 그동안 상대가 수비 축적 → 발진 즉시 전멸).
                # 수비·증원은 전투력 환산(pow_r — 2026-07-05 규칙 B 공격 계열).
                need = (math.ceil(near_def * pow_r) + e_turret
                        + math.ceil(min(e_cap, OM.train_rate) * eta * pow_r))
                if len(avail) >= need or turn >= MAX_TURN - eta - 3:
                    plan.push_launched = True
                    plan.push_since = turn
                    plan.push_hq_hp0 = opp_hq_b.hp if opp_hq_b else 0
            if plan.push_launched:
                for w in avail:
                    orders[w.id] = M.opp_hq
                for w in my_warriors:           # 전방 잔여 병력도 합류
                    if (w.state is WState.STATIONARY and w.id not in orders
                            and w.region not in my_buildings
                            and w.region != M.opp_hq):
                        orders[w.id] = M.opp_hq

    # ── 총동원(전 페이즈 안전장치): HQ 함락 추정시에만 가리슨 소환 ────────
    # 사용자 규칙: "본부 파괴가 될 정도일시 기지 전사들을 데려와 본부에서
    # 싸우게 한다. 아니라면 기지에 가만히 있는다."
    if hq_falls_in != math.inf:
        for r in my_buildings:
            if r == M.my_hq or r in enemy_regions:
                continue
            for w in stat_at(r):
                orders[w.id] = M.my_hq

    # ── 아사 서킷브레이커(안전망, P0 2026-07-06): 잔고 임박고갈 + 수입<유지비
    #    + HQ 안전 + 미발진(활성 공세 아님)이면, 유휴 낙오병(활성 원정대·출격대
    #    제외)을 가장 가까운 '빈 일자리' 아군 기지로 회수해 수입을 복구 →
    #    death-spiral 차단. 총동원(hq_falls_in)·활성 PUSH·원정대는 건드리지
    #    않는다(방어·결정타 레이스 우선). 순수 안전망: 이미 낙오병을 HQ로
    #    회수하던 GATHER/DEFEND 로직의 목적지를 '빈 일자리 최근접 기지'로만
    #    정밀화하고, 회수 로직이 없던 페이즈(TOUR/CONSOL/MASS 등)에도 적용.
    if (hq_falls_in == math.inf and not plan.push_launched
            and actual_income < upkeep and S.gold < upkeep * 2):
        need_w = (upkeep - actual_income + WORK_INCOME - 1) // WORK_INCOME
        open_bases = [r for r, b in my_buildings.items()
                      if r != M.opp_hq and len(stat_at(r)) < b.work_cap()]
        if open_bases:
            cand = sorted(
                (w for w in my_warriors
                 if w.state is WState.STATIONARY
                 and w.region not in my_buildings and w.region != M.opp_hq
                 and w.id.num not in plan.sortie_ids
                 and not (plan.tour_started and w.id.num in plan.tour_ids)),
                key=lambda w: min(P.hops[w.region][r] for r in open_bases))
            for w in cand[:need_w]:
                dest = min(open_bases, key=lambda r: P.hops[w.region][r])
                if P.hops[w.region][dest] < math.inf:
                    orders[w.id] = dest

    plan.stance = plan.phase

    # ── 발령(중복 없음: STATIONARY에게만 명령, MOVING 재명령 없음) ───────
    for w in my_warriors:
        dst = orders.get(w.id)
        if dst is None or dst == w.region:
            continue
        c = 0 if dst in my_buildings else MOVE_COST
        if gold >= c:
            a.moves.append((w.id, dst))
            gold -= c

    return a


def main() -> None:
    M, S = parse_init()
    _apply_tuned_constants(M.N)   # STC9: 맵 크기 구간별 상수(STC8이면 no-op)
    P = calculate_paths(M)
    OM = OpponentModel()   # 게임 전체에 걸쳐 상대 전략을 누적 관측
    plan = Plan()          # 게임 전체에 지속되는 전략/전술 상태(타겟 커밋·방어태세)

    while (turn := read_turn_start()) is not None:
        a = decide(S, M, P, turn, OM, plan)
        emit(a)
        read_turn_result(S, M, a)


if __name__ == "__main__":
    main()
