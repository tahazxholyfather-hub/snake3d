export const SIZE = 12;
export const BASE_TICK = 260;
export const MIN_TICK = 100;
export const TICK_STEP = 6;
export const START_LENGTH = 4;
export const DEFAULT_YAW = -0.95;

const CARDS = Object.freeze([
  Object.freeze({ x: 1, y: 0, z: 0 }),
  Object.freeze({ x: -1, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: 1 }),
  Object.freeze({ x: 0, y: 0, z: -1 }),
]);

export function sameDir(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function opposite(a, b) {
  return a.x === -b.x && a.y === -b.y && a.z === -b.z;
}

export function keyOf(p) {
  return `${p.x},${p.y},${p.z}`;
}

export function isCardinal(dir) {
  if (!dir) return false;
  const { x, y, z } = dir;
  const axes = [x, y, z];
  if (!axes.every((value) => value === 0 || value === 1 || value === -1)) return false;
  return Math.abs(x) + Math.abs(y) + Math.abs(z) === 1;
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

export function speedLevel(tickMs) {
  return 1 + Math.round((BASE_TICK - tickMs) / TICK_STEP);
}

export function axisPair(yaw) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let forward = CARDS[0];
  let best = -Infinity;
  for (const card of CARDS) {
    const dot = card.x * fx + card.z * fz;
    if (dot > best) {
      best = dot;
      forward = card;
    }
  }
  const right = { x: -forward.z, y: 0, z: forward.x };
  return {
    forward: { x: forward.x, y: 0, z: forward.z },
    back: { x: -forward.x, y: 0, z: -forward.z },
    right,
    left: { x: -right.x, y: 0, z: -right.z },
    up: { x: 0, y: 1, z: 0 },
    down: { x: 0, y: -1, z: 0 },
  };
}

export function directionFor(yaw, command) {
  return axisPair(yaw)[command] ?? null;
}

function cloneCell(cell) {
  return { x: cell.x, y: cell.y, z: cell.z };
}

export function createInitialSnake(size = SIZE) {
  const z = Math.floor(size / 2);
  const y = Math.min(size - 2, Math.max(1, Math.floor(size / 3)));
  const headX = Math.min(size - 2, START_LENGTH - 1);
  const segments = [];
  for (let i = 0; i < START_LENGTH; i += 1) {
    segments.push({ x: headX - i, y, z });
  }
  return segments;
}

export function spawnFood(size, occupied, rng = Math.random, near) {
  const free = [];
  const far = [];
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) {
        const cell = { x, y, z };
        if (occupied.has(keyOf(cell))) continue;
        free.push(cell);
        if (!near || manhattan(cell, near) >= 3) far.push(cell);
      }
    }
  }
  const pool = far.length > 0 ? far : free;
  if (pool.length === 0) return null;
  return cloneCell(pool[Math.floor(rng() * pool.length)]);
}

export function createState(size = SIZE, rng = Math.random) {
  const segments = createInitialSnake(size);
  const occupied = new Set(segments.map(keyOf));
  return {
    size,
    segments,
    previous: segments.map(cloneCell),
    direction: { x: 1, y: 0, z: 0 },
    queue: [],
    food: spawnFood(size, occupied, rng, segments[0]),
    score: 0,
    alive: true,
    won: false,
    tickMs: BASE_TICK,
  };
}

function facingAfterQueue(state) {
  let facing = state.direction;
  for (const queued of state.queue) {
    if (!opposite(queued, facing)) facing = queued;
  }
  return facing;
}

export function enqueue(state, dir) {
  if (!state.alive || state.won) return false;
  if (!isCardinal(dir)) return false;
  const facing = facingAfterQueue(state);
  if (sameDir(dir, facing) || opposite(dir, facing)) return false;
  if (state.queue.length >= 3) return false;
  state.queue.push({ x: dir.x, y: dir.y, z: dir.z });
  return true;
}

function hitsBody(segments, next, ignoreTail) {
  const last = segments.length - 1;
  return segments.some((segment, index) => {
    if (ignoreTail && index === last) return false;
    return segment.x === next.x && segment.y === next.y && segment.z === next.z;
  });
}

export function step(state, rng = Math.random) {
  if (!state.alive || state.won) return { event: 'idle' };

  while (state.queue.length > 0) {
    const next = state.queue.shift();
    if (opposite(next, state.direction) || sameDir(next, state.direction)) continue;
    state.direction = { x: next.x, y: next.y, z: next.z };
    break;
  }

  const head = state.segments[0];
  const nextHead = {
    x: head.x + state.direction.x,
    y: head.y + state.direction.y,
    z: head.z + state.direction.z,
  };

  if (
    nextHead.x < 0 ||
    nextHead.y < 0 ||
    nextHead.z < 0 ||
    nextHead.x >= state.size ||
    nextHead.y >= state.size ||
    nextHead.z >= state.size
  ) {
    state.alive = false;
    return { event: 'dead', reason: 'wall' };
  }

  const willEat = state.food !== null && sameDir(nextHead, state.food);
  if (hitsBody(state.segments, nextHead, !willEat)) {
    state.alive = false;
    return { event: 'dead', reason: 'self' };
  }

  state.previous = state.segments.map(cloneCell);
  state.segments.unshift(nextHead);

  if (willEat) {
    state.score += 10;
    state.tickMs = Math.max(MIN_TICK, state.tickMs - TICK_STEP);
    const occupied = new Set(state.segments.map(keyOf));
    state.food = spawnFood(state.size, occupied, rng, nextHead);
    if (!state.food) {
      state.won = true;
      return { event: 'win' };
    }
    return { event: 'eat' };
  }

  state.segments.pop();
  return { event: 'move' };
}
