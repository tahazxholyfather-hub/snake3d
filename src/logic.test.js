import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASE_TICK,
  DEFAULT_YAW,
  axisPair,
  createState,
  directionFor,
  enqueue,
  keyOf,
  manhattan,
  opposite,
  sameDir,
  step,
} from './logic.js';

test('a new game starts inside the cube, moving along +x', () => {
  const state = createState(10, () => 0);
  assert.equal(state.segments.length, 4);
  assert.deepEqual(state.direction, { x: 1, y: 0, z: 0 });
  for (const segment of state.segments) {
    assert.ok(segment.x >= 0 && segment.x < 10);
    assert.ok(segment.y >= 0 && segment.y < 10);
    assert.ok(segment.z >= 0 && segment.z < 10);
  }
  const occupied = new Set(state.segments.map(keyOf));
  assert.equal(occupied.has(keyOf(state.food)), false);
  assert.ok(manhattan(state.food, state.segments[0]) >= 3);
  assert.equal(state.tickMs, BASE_TICK);
  assert.equal(state.segments[0].x, 3);
  assert.ok(state.size - 1 - state.segments[0].x >= 6);
});

test('turns are queued and a reverse is rejected', () => {
  const state = createState(10, () => 0);
  assert.equal(enqueue(state, { x: -1, y: 0, z: 0 }), false);
  assert.equal(enqueue(state, { x: 1, y: 0, z: 0 }), false);
  assert.equal(enqueue(state, { x: 0, y: 0, z: -1 }), true);
  assert.equal(enqueue(state, { x: 0, y: 0, z: 1 }), false);
  assert.equal(enqueue(state, { x: 0, y: 1, z: 0 }), true);
  assert.equal(state.queue.length, 2);

  const first = step(state);
  assert.equal(first.event, 'move');
  assert.deepEqual(state.direction, { x: 0, y: 0, z: -1 });
  const second = step(state);
  assert.equal(second.event, 'move');
  assert.deepEqual(state.direction, { x: 0, y: 1, z: 0 });
});

test('the queue keeps at most three turns', () => {
  const state = createState(10, () => 0);
  assert.equal(enqueue(state, { x: 0, y: 1, z: 0 }), true);
  assert.equal(enqueue(state, { x: 0, y: 0, z: 1 }), true);
  assert.equal(enqueue(state, { x: -1, y: 0, z: 0 }), true);
  assert.equal(enqueue(state, { x: 0, y: -1, z: 0 }), false);
  assert.equal(state.queue.length, 3);
});

test('a forced reverse in the queue is discarded', () => {
  const state = createState(10, () => 0);
  state.queue.push({ x: -1, y: 0, z: 0 });
  const result = step(state);
  assert.equal(result.event, 'move');
  assert.deepEqual(state.direction, { x: 1, y: 0, z: 0 });
  assert.equal(state.segments[0].x, state.previous[0].x + 1);
});

test('eating grows the snake, scores, and speeds up', () => {
  const state = createState(6, () => 0);
  const head = state.segments[0];
  state.food = { x: head.x + 1, y: head.y, z: head.z };
  const before = state.segments.length;
  const result = step(state, () => 0);
  assert.equal(result.event, 'eat');
  assert.equal(state.segments.length, before + 1);
  assert.equal(state.score, 10);
  assert.equal(state.tickMs, BASE_TICK - 6);
  assert.equal(new Set(state.segments.map(keyOf)).has(keyOf(state.food)), false);
});

test('a wall ends the run without moving the head into it', () => {
  const state = createState(10, () => 0);
  state.segments[0] = { x: 9, y: 2, z: 4 };
  state.direction = { x: 1, y: 0, z: 0 };
  const result = step(state);
  assert.deepEqual(result, { event: 'dead', reason: 'wall' });
  assert.equal(state.alive, false);
  assert.equal(state.segments[0].x, 9);
});

test('the snake can enter the cell its tail is leaving', () => {
  const state = createState(10, () => 0);
  state.segments = [
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 },
  ];
  state.direction = { x: 0, y: 1, z: 0 };
  state.food = { x: 0, y: 0, z: 0 };
  const result = step(state);
  assert.equal(result.event, 'move');
  assert.deepEqual(state.segments[0], { x: 1, y: 1, z: 0 });
});

test('running into the body ends the run', () => {
  const state = createState(10, () => 0);
  state.segments = [
    { x: 1, y: 1, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
    { x: 2, y: 1, z: 1 },
    { x: 2, y: 2, z: 1 },
  ];
  state.direction = { x: 1, y: 0, z: 0 };
  state.food = { x: 0, y: 0, z: 0 };
  const result = step(state);
  assert.deepEqual(result, { event: 'dead', reason: 'self' });
});

test('eating the last empty cell wins', () => {
  const food = { x: 1, y: 1, z: 1 };
  const segments = [
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 1 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 1, z: 1 },
  ];
  const state = {
    size: 2,
    segments,
    previous: segments.map((cell) => ({ ...cell })),
    direction: { x: 0, y: 0, z: 1 },
    queue: [],
    food,
    score: 0,
    alive: true,
    won: false,
    tickMs: BASE_TICK,
  };
  const result = step(state);
  assert.equal(result.event, 'win');
  assert.equal(state.won, true);
  assert.equal(state.food, null);
  assert.equal(state.segments.length, 8);
  assert.equal(step(state).event, 'idle');
});

test('camera-relative controls stay perpendicular', () => {
  for (const yaw of [0, 0.4, -0.95, Math.PI / 2, Math.PI, -2.2]) {
    const axes = axisPair(yaw);
    const horizontal = [axes.forward, axes.back, axes.left, axes.right];
    assert.equal(new Set(horizontal.map(keyOf)).size, 4);
    assert.equal(axes.forward.x * axes.right.x + axes.forward.z * axes.right.z, 0);
    assert.ok(opposite(axes.forward, axes.back));
    assert.ok(opposite(axes.left, axes.right));
    assert.deepEqual(axes.up, { x: 0, y: 1, z: 0 });
  }
  assert.deepEqual(directionFor(0, 'forward'), { x: 0, y: 0, z: -1 });
  assert.deepEqual(directionFor(0, 'right'), { x: 1, y: 0, z: 0 });
  assert.ok(sameDir(directionFor(DEFAULT_YAW, 'forward'), { x: 1, y: 0, z: 0 }));
});
