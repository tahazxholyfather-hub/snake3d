import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  DEFAULT_YAW,
  createState,
  directionFor,
  enqueue,
  opposite,
  speedLevel,
  step,
} from './logic.js';

const KEY_COMMANDS = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  Numpad8: 'forward',
  ArrowDown: 'back',
  KeyS: 'back',
  Numpad2: 'back',
  ArrowLeft: 'left',
  KeyA: 'left',
  Numpad4: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Numpad6: 'right',
  KeyQ: 'up',
  PageUp: 'up',
  Numpad9: 'up',
  KeyE: 'down',
  PageDown: 'down',
  Numpad3: 'down',
};

const DEFAULT_PITCH = 0.58;

function fadeMaterial(material, opacity) {
  const list = Array.isArray(material) ? material : [material];
  for (const item of list) {
    item.transparent = true;
    item.opacity = opacity;
    item.depthWrite = false;
    item.toneMapped = false;
  }
}

export function mountGame(canvas, hooks = {}) {
  if (canvas.__snake) canvas.__snake.destroy();
  const game = new SnakeView(canvas, hooks);
  canvas.__snake = game;
  return game;
}

class SnakeView {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.mode = 'menu';
    this.armed = false;
    this.reason = null;
    this.time = 0;
    this.acc = 0;
    this.shake = 0;
    this.hit = 0;
    this.foodAnim = 1;
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.zoom = 1;
    this.lookBias = 0;
    this.userAimed = false;
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.booted = false;
    this.looping = true;
    this.state = createState();
    this.abort = new AbortController();

    this.cell = new THREE.Vector3();
    this.world = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.ref = new THREE.Vector3();
    this.eyeOffset = new THREE.Vector3();
    this.color = new THREE.Color();
    this.red = new THREE.Color(0xff3355);
    this.gold = new THREE.Color(0xffc14d);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07060f);
    this.scene.fog = new THREE.FogExp2(0x07060f, 0.013);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 220);

    this.size = this.state.size;
    this.origin = (this.size - 1) / 2;
    this.floorY = -this.size / 2 + 0.045;

    this.buildArena();
    this.buildActors();
    this.buildStars();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.48, 0.42, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.bindInput();
    this.resize();
    this.emit('snapshot');
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  buildArena() {
    const half = this.size / 2;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(this.size, this.size, this.size)),
      new THREE.LineBasicMaterial({ color: 0x9aefff, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    this.scene.add(edges);

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(this.size - 0.04, this.size - 0.04, this.size - 0.04),
      new THREE.MeshBasicMaterial({
        color: 0x12384f,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.scene.add(shell);

    const floor = new THREE.GridHelper(this.size, this.size, 0x6adfff, 0x1a4d66);
    floor.position.y = -half + 0.012;
    fadeMaterial(floor.material, 0.55);
    this.scene.add(floor);

    const ceiling = new THREE.GridHelper(this.size, this.size, 0x3a8eaa, 0x14384a);
    ceiling.position.y = half - 0.012;
    fadeMaterial(ceiling.material, 0.18);
    this.scene.add(ceiling);

    const wallZ = new THREE.GridHelper(this.size, this.size, 0x3a8eaa, 0x14384a);
    wallZ.rotation.x = Math.PI / 2;
    wallZ.position.z = -half + 0.02;
    fadeMaterial(wallZ.material, 0.16);
    this.scene.add(wallZ);

    const wallX = new THREE.GridHelper(this.size, this.size, 0x3a8eaa, 0x14384a);
    wallX.rotation.z = -Math.PI / 2;
    wallX.position.x = -half + 0.02;
    fadeMaterial(wallX.material, 0.16);
    this.scene.add(wallX);

    this.scene.add(new THREE.HemisphereLight(0xc5f4ff, 0x241228, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(7, 12, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7c6bff, 0.28);
    fill.position.set(-8, -3, -6);
    this.scene.add(fill);
  }

  buildActors() {
    this.segmentGeo = new THREE.SphereGeometry(1, 26, 18);
    this.parts = [];

    this.eyeGeo = new THREE.SphereGeometry(1, 14, 10);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x071018, toneMapped: false });
    this.pupilMat = new THREE.MeshBasicMaterial({ color: 0xe9fdff, toneMapped: false });
    this.eyes = [this.makeEye(), this.makeEye()];

    const foodCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd56a, toneMapped: false }),
    );
    this.wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.62, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffe3a6,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
      }),
    );
    this.foodLight = new THREE.PointLight(0xffb020, 7, 9, 2);
    this.foodGroup = new THREE.Group();
    this.foodGroup.add(foodCore, this.wire, this.foodLight);
    this.scene.add(this.foodGroup);

    this.headLight = new THREE.PointLight(0x86f3ff, 6, 8, 2);
    this.scene.add(this.headLight);

    this.headGuide = this.makeGuide(0x7eefff, 0.45);
    this.foodGuide = this.makeGuide(0xffc14d, 0.4);
    this.headRing = this.makeRing(0x7eefff);
    this.foodRing = this.makeRing(0xffc14d);

    this.sparks = new Sparks(this.scene);
  }

  makeEye() {
    const eye = new THREE.Mesh(this.eyeGeo, this.eyeMat);
    const pupil = new THREE.Mesh(this.eyeGeo, this.pupilMat);
    this.scene.add(eye, pupil);
    return { eye, pupil };
  }

  makeGuide(color, opacity) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false }),
    );
    this.scene.add(line);
    return line;
  }

  makeRing(color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.4, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    return ring;
  }

  buildStars() {
    const count = 320;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      const radius = 30 + Math.random() * 46;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      color.setHSL(0.5 + Math.random() * 0.12, 0.35, 0.72 + Math.random() * 0.2);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.16,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.scene.add(this.stars);
  }

  bindInput() {
    const signal = this.abort.signal;
    window.addEventListener('keydown', (event) => this.onKey(event), { signal });
    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event), { signal });
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event), { signal });
    this.canvas.addEventListener('pointerup', () => {
      this.dragging = false;
    }, { signal });
    this.canvas.addEventListener('pointercancel', () => {
      this.dragging = false;
    }, { signal });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoom = clamp(this.zoom * (event.deltaY > 0 ? 1.07 : 0.935), 0.68, 1.85);
    }, { signal, passive: false });
    this.canvas.addEventListener('dblclick', () => this.resetCamera(), { signal });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    window.addEventListener('resize', () => this.resize(), { signal });
  }

  onKey(event) {
    if (event.repeat) return;
    const typing = document.activeElement?.tagName === 'BUTTON';
    if ((event.code === 'Space' || event.code === 'Enter') && typing) return;

    const command = KEY_COMMANDS[event.code];
    if (command) {
      event.preventDefault();
      this.nudge(command);
      return;
    }
    if (event.code === 'Space' || event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault();
      this.togglePause();
      return;
    }
    if (event.code === 'Enter') {
      event.preventDefault();
      this.primaryAction();
      return;
    }
    if (event.code === 'KeyR' && this.mode !== 'playing') {
      event.preventDefault();
      if (this.mode === 'menu') this.start();
      else this.restart();
    }
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (dx === 0 && dy === 0) return;
    this.userAimed = true;
    this.yaw -= dx * 0.005;
    this.pitch = clamp(this.pitch - dy * 0.004, 0.2, 1.18);
  }

  resetCamera() {
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.zoom = 1;
    this.userAimed = false;
  }

  resize() {
    const parent = this.canvas.parentElement ?? document.body;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.6);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.lookBias = height < 780 ? 1.7 : 0;
  }

  snapshot() {
    return {
      mode: this.mode,
      score: this.state.score,
      length: this.state.segments.length,
      speed: speedLevel(this.state.tickMs),
      height: this.state.segments[0].y + 1,
      reason: this.reason,
      waiting: this.mode === 'playing' && !this.armed,
    };
  }

  emit(type) {
    this.hooks.onEvent?.({ type, ...this.snapshot() });
  }

  start() {
    if (this.mode === 'playing') return;
    if (this.mode !== 'menu') {
      this.restart();
      return;
    }
    this.mode = 'playing';
    this.armed = false;
    this.reason = null;
    this.acc = 0;
    this.emit('start');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    this.emit('snapshot');
  }

  restart() {
    this.state = createState();
    this.mode = 'playing';
    this.armed = false;
    this.reason = null;
    this.acc = 0;
    this.shake = 0;
    this.hit = 0;
    this.foodAnim = 1;
    this.emit('start');
  }

  togglePause() {
    if (this.mode === 'playing') this.mode = 'paused';
    else if (this.mode === 'paused') this.mode = 'playing';
    else return;
    this.emit('snapshot');
  }

  primaryAction() {
    if (this.mode === 'menu') this.start();
    else if (this.mode === 'paused') this.resume();
    else this.restart();
  }

  nudge(command) {
    if (this.mode === 'paused' || this.mode === 'dead' || this.mode === 'won') return;
    if (this.mode === 'menu') this.start();
    const dir = directionFor(this.yaw, command);
    if (!dir) return;
    if (!this.armed) {
      if (opposite(dir, this.state.direction)) return;
      enqueue(this.state, dir);
      this.armed = true;
      this.acc = Math.max(0, this.state.tickMs - 40);
      this.emit('snapshot');
      return;
    }
    enqueue(this.state, dir);
  }

  frame(now) {
    if (!this.looping) return;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.time += dt;
    this.update(dt);
    this.composer.render();
    requestAnimationFrame(this.frame);
  }

  update(dt) {
    if (this.mode === 'playing' && this.armed) {
      this.acc += dt;
      let guard = 0;
      while (this.acc >= this.state.tickMs && this.mode === 'playing' && guard < 4) {
        this.acc -= this.state.tickMs;
        guard += 1;
        this.applyStep(step(this.state));
      }
      if (this.acc > this.state.tickMs) this.acc = this.state.tickMs;
    }

    const moving = this.mode === 'playing' || this.mode === 'paused';
    const t = this.reduce || !moving ? 1 : Math.min(1, this.acc / this.state.tickMs);
    this.poseSnake(t);
    this.poseFood(dt);
    this.sparks.update(dt);
    if (this.hit > 0) this.hit = Math.max(0, this.hit - dt / 700);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt / 420);
    if (!this.reduce) this.stars.rotation.y += dt * 0.00003;
    this.poseCamera(dt);
  }

  applyStep(result) {
    if (result.event === 'move') {
      this.emit('snapshot');
      return;
    }
    if (result.event === 'eat') {
      this.foodAnim = 0;
      const origin = this.toWorld(this.state.segments[0].x, this.state.segments[0].y, this.state.segments[0].z, this.world);
      this.sparks.spawn(origin, this.gold);
      this.emit('eat');
      return;
    }
    if (result.event === 'dead') {
      this.mode = 'dead';
      this.reason = result.reason;
      this.state.previous = this.state.segments.map((cell) => ({ ...cell }));
      this.acc = this.state.tickMs;
      this.hit = 1;
      this.shake = 1;
      this.emit('die');
      return;
    }
    if (result.event === 'win') {
      this.mode = 'won';
      this.acc = this.state.tickMs;
      this.foodAnim = 1;
      this.emit('win');
    }
  }

  ensureParts(count) {
    while (this.parts.length < count) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        roughness: 0.32,
        metalness: 0.16,
      });
      const mesh = new THREE.Mesh(this.segmentGeo, material);
      this.scene.add(mesh);
      this.parts.push({ mesh, material });
    }
    for (let i = 0; i < this.parts.length; i += 1) this.parts[i].mesh.visible = i < count;
  }

  poseSnake(t) {
    const segments = this.state.segments;
    const count = segments.length;
    this.ensureParts(count);
    let headScale = 0.46;
    for (let i = 0; i < count; i += 1) {
      const part = this.parts[i];
      this.sample(i, t, this.cell);
      this.toWorld(this.cell.x, this.cell.y, this.cell.z, this.world);
      part.mesh.position.copy(this.world);
      const taper = count <= 1 ? 0 : i / (count - 1);
      const pulse = i === 0 && !this.reduce ? 1 + Math.sin(this.time * 0.006) * 0.035 : 1;
      const scale = (i === 0 ? 0.46 : 0.38 - taper * 0.14) * pulse;
      if (i === 0) headScale = scale;
      part.mesh.scale.setScalar(scale);
      const hue = (188 + taper * 128) / 360;
      this.color.setHSL(hue, 0.92, i === 0 ? 0.68 : 0.54);
      if (this.hit > 0) this.color.lerp(this.red, Math.min(1, this.hit));
      part.material.color.copy(this.color);
      part.material.emissive.copy(this.color);
      part.material.emissiveIntensity = i === 0 ? 1.85 : 0.95;
    }

    const head = this.parts[0].mesh.position;
    this.headLight.position.copy(head);
    this.placeEyes(head, headScale);
    this.placeGuide(this.headGuide, this.headRing, head, 0x7eefff);
  }

  placeEyes(head, headScale) {
    const dir = this.state.direction;
    this.forward.set(dir.x, dir.y, dir.z);
    if (Math.abs(this.forward.y) > 0.9) this.ref.set(0, 0, 1);
    else this.ref.set(0, 1, 0);
    this.right.crossVectors(this.forward, this.ref).normalize();
    this.up.crossVectors(this.right, this.forward).normalize();
    const shut = !this.reduce && this.time % 3800 > 3520;
    const squash = shut ? 0.28 : 1;
    this.eyes.forEach(({ eye, pupil }, index) => {
      const sign = index === 0 ? -1 : 1;
      this.eyeOffset
        .set(0, 0, 0)
        .addScaledVector(this.forward, 0.74)
        .addScaledVector(this.right, 0.4 * sign)
        .addScaledVector(this.up, 0.24)
        .normalize();
      eye.position.copy(head).addScaledVector(this.eyeOffset, headScale * 0.9);
      pupil.position.copy(head).addScaledVector(this.eyeOffset, headScale * 1.08);
      const size = headScale * 0.22;
      eye.scale.set(size, size * squash, size);
      pupil.scale.setScalar(size * 0.42);
    });
  }

  poseFood(dt) {
    const food = this.state.food;
    const visible = Boolean(food);
    this.foodGroup.visible = visible;
    this.foodGuide.visible = visible;
    this.foodRing.visible = visible;
    if (!food) return;
    this.foodAnim = Math.min(1, this.foodAnim + dt / 240);
    const pop = 1 - (1 - this.foodAnim) ** 3;
    this.toWorld(food.x, food.y, food.z, this.world);
    const bob = this.reduce ? 0 : Math.sin(this.time * 0.004) * 0.1;
    this.foodGroup.position.set(this.world.x, this.world.y + bob, this.world.z);
    this.foodGroup.scale.setScalar(0.35 + pop * 0.65);
    if (!this.reduce) {
      this.wire.rotation.y += dt * 0.0016;
      this.wire.rotation.x += dt * 0.0008;
    }
    this.placeGuide(this.foodGuide, this.foodRing, this.foodGroup.position);
  }

  placeGuide(line, ring, position) {
    const attr = line.geometry.attributes.position;
    attr.setXYZ(0, position.x, position.y, position.z);
    attr.setXYZ(1, position.x, this.floorY, position.z);
    attr.needsUpdate = true;
    ring.position.set(position.x, this.floorY, position.z);
  }

  sample(index, t, out) {
    const current = this.state.segments[index];
    const previous = this.state.previous[index] ?? current;
    out.set(
      previous.x + (current.x - previous.x) * t,
      previous.y + (current.y - previous.y) * t,
      previous.z + (current.z - previous.z) * t,
    );
    return out;
  }

  toWorld(x, y, z, out) {
    return out.set(x - this.origin, y - this.origin, z - this.origin);
  }

  poseCamera(dt) {
    this.sample(0, this.reduce || this.mode === 'menu' || this.mode === 'dead' || this.mode === 'won' ? 1 : Math.min(1, this.acc / this.state.tickMs), this.cell);
    this.toWorld(this.cell.x, this.cell.y, this.cell.z, this.look);
    const pitch = this.pitch + (this.reduce || this.userAimed || this.mode === 'playing' ? 0 : Math.sin(this.time * 0.00028) * 0.045);
    const distance = this.baseDistance() * this.zoom;
    const planar = Math.cos(pitch);
    this.desired.set(
      this.look.x + distance * planar * Math.sin(this.yaw),
      this.look.y + distance * Math.sin(pitch),
      this.look.z + distance * planar * Math.cos(this.yaw),
    );
    if (this.shake > 0) {
      this.desired.x += (Math.random() - 0.5) * this.shake * 0.45;
      this.desired.y += (Math.random() - 0.5) * this.shake * 0.45;
    }
    if (!this.booted) {
      this.camera.position.copy(this.desired);
      this.booted = true;
    } else {
      const follow = 1 - Math.pow(0.0015, dt / 1000);
      this.camera.position.lerp(this.desired, follow);
    }
    this.camera.lookAt(this.look.x, this.look.y - this.lookBias, this.look.z);
  }

  baseDistance() {
    const span = this.size * 1.7;
    const aspect = this.camera.aspect || 1;
    if (aspect < 0.75) return span * 1.5;
    if (aspect < 1.15) return span * 1.2;
    return span;
  }

  destroy() {
    this.looping = false;
    this.abort.abort();
    this.composer.dispose();
    this.renderer.dispose();
    const geometries = new Set();
    const materials = new Set();
    this.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const material = object.material;
      if (Array.isArray(material)) material.forEach((item) => materials.add(item));
      else if (material) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
}

class Sparks {
  constructor(scene) {
    this.scene = scene;
    this.alive = [];
    this.pool = [];
    this.geo = new THREE.SphereGeometry(0.07, 8, 6);
  }

  spawn(origin, color) {
    for (let i = 0; i < 14; i += 1) {
      const spark = this.pool.pop() ?? this.create();
      spark.mesh.visible = true;
      spark.mesh.position.copy(origin);
      spark.life = 1;
      const speed = 1.4 + Math.random() * 2.4;
      spark.vel.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed);
      spark.material.color.copy(color);
      spark.material.opacity = 1;
      this.alive.push(spark);
    }
  }

  create() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc14d,
      transparent: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.geo, material);
    this.scene.add(mesh);
    return { mesh, material, vel: new THREE.Vector3(), life: 0 };
  }

  update(dt) {
    const seconds = dt / 1000;
    for (let i = this.alive.length - 1; i >= 0; i -= 1) {
      const spark = this.alive[i];
      spark.life -= seconds * 1.7;
      spark.mesh.position.addScaledVector(spark.vel, seconds);
      spark.vel.y -= seconds * 1.4;
      spark.material.opacity = Math.max(0, spark.life);
      spark.mesh.scale.setScalar(Math.max(0.2, spark.life));
      if (spark.life <= 0) {
        spark.mesh.visible = false;
        this.pool.push(spark);
        this.alive.splice(i, 1);
      }
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
