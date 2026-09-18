/**
 * GameEngine — основной движок игры FPV STRIKE
 * Содержит: мир, физику дрона, врагов, оружие, частицы, миссии
 */
import * as THREE from 'three';
import { audioManager } from './audio';

// ===================== ТИПЫ И ИНТЕРФЕЙСЫ =====================

export interface GameSettings {
  mouseSensX: number;
  mouseSensY: number;
  invertY: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  quality: 'low' | 'medium' | 'high';
  language: 'ru' | 'en';
}

export interface GameState {
  phase: 'menu' | 'playing' | 'paused' | 'missionBrief' | 'victory' | 'defeat' | 'shop' | 'tutorial';
  currentMission: number;
  score: number;
  coins: number;
  time: number;
  droneHP: number;
  droneMaxHP: number;
  battery: number;
  bombs: number;
  maxBombs: number;
  cameraMode: 'fpv' | 'chase' | 'orbit' | 'free' | 'cockpit';
  missionObjectives: MissionObjective[];
  warnings: string[];
  kills: number;
  accuracy: number;
  shotsFired: number;
  shotsHit: number;
  stars: number;
  upgrades: PlayerUpgrades;
  droneAlt: number;
  droneSpeed: number;
  droneThrottle: number;
}

export interface MissionObjective {
  text: string;
  completed: boolean;
  type: 'destroy' | 'reach' | 'collect' | 'survive' | 'recon';
  target?: string;
  current: number;
  required: number;
}

export interface PlayerUpgrades {
  maxHP: number;
  batteryCapacity: number;
  bombDamage: number;
  repairSpeed: number;
  stealth: number;
  extraBombs: number;
}

export interface DroneState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  quaternion: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  throttle: number;
  roll: number;
  pitch: number;
  yaw: number;
  damaged: boolean;
  motorHealth: number[];
  overheated: boolean;
}

interface Enemy {
  type: 'soldier' | 'aagun' | 'rocket' | 'drone' | 'boss';
  mesh: THREE.Group;
  position: THREE.Vector3;
  hp: number;
  maxHP: number;
  state: 'patrol' | 'alert' | 'attack' | 'retreat' | 'dead';
  stateTimer: number;
  targetPos: THREE.Vector3;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  detectionRange: number;
  attackRange: number;
  attackCooldown: number;
  attackTimer: number;
  speed: number;
  alive: boolean;
  deathTimer: number;
  // Для босса
  phase?: number;
  phaseTimer?: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  damage: number;
  lifetime: number;
  type: 'bullet' | 'rocket' | 'bomb' | 'tracer';
  owner: 'player' | 'enemy';
  target?: THREE.Vector3;
  trail?: THREE.Line;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
  maxLifetime: number;
  gravity: boolean;
  scale: number;
}

interface Pickup {
  mesh: THREE.Group;
  position: THREE.Vector3;
  type: 'health' | 'battery' | 'bomb' | 'coins';
  value: number;
  collected: boolean;
  bobTimer: number;
}

// ===================== МИССИИ =====================

const MISSIONS = [
  {
    name: 'Обучение',
    description: 'Пролетите через чекпоинты и вернитесь на базу',
    objectives: [
      { text: 'Пролетите через чекпоинт 1', type: 'reach' as const, required: 1 },
      { text: 'Пролетите через чекпоинт 2', type: 'reach' as const, required: 1 },
      { text: 'Пролетите через чекпоинт 3', type: 'reach' as const, required: 1 },
      { text: 'Вернитесь на базу', type: 'reach' as const, required: 1 },
    ],
    enemies: [],
    timeLimit: 180,
  },
  {
    name: 'Разведка',
    description: 'Сфотографируйте 3 вражеские позиции',
    objectives: [
      { text: 'Разведать базу Alpha', type: 'recon' as const, required: 1 },
      { text: 'Разведать базу Bravo', type: 'recon' as const, required: 1 },
      { text: 'Разведать базу Charlie', type: 'recon' as const, required: 1 },
    ],
    enemies: ['soldier', 'soldier', 'soldier'],
    timeLimit: 240,
  },
  {
    name: 'Штурм',
    description: 'Уничтожьте вражескую базу',
    objectives: [
      { text: 'Уничтожить зенитку', type: 'destroy' as const, required: 1 },
      { text: 'Уничтожить солдат (0/5)', type: 'destroy' as const, required: 5 },
      { text: 'Уничтожить ангар', type: 'destroy' as const, required: 1 },
    ],
    enemies: ['soldier', 'soldier', 'soldier', 'soldier', 'soldier', 'aagun'],
    timeLimit: 300,
  },
  {
    name: 'Оборона',
    description: 'Защитите свою базу от волн врагов',
    objectives: [
      { text: 'Отразить волну 1', type: 'survive' as const, required: 1 },
      { text: 'Отразить волну 2', type: 'survive' as const, required: 1 },
      { text: 'Отразить волну 3', type: 'survive' as const, required: 1 },
    ],
    enemies: ['soldier', 'soldier', 'drone', 'rocket', 'drone'],
    timeLimit: 360,
  },
  {
    name: 'Босс',
    description: 'Уничтожьте супер-дрон противника',
    objectives: [
      { text: 'Уничтожить босс-дрон', type: 'destroy' as const, required: 1 },
    ],
    enemies: ['boss', 'soldier', 'soldier', 'aagun', 'drone'],
    timeLimit: 420,
  },
];

// ===================== УТИЛИТЫ =====================

function noise2D(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  
  const n00 = noise2D(ix, iy);
  const n10 = noise2D(ix + 1, iy);
  const n01 = noise2D(ix, iy + 1);
  const n11 = noise2D(ix + 1, iy + 1);
  
  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;
  
  return nx0 * (1 - sy) + nx1 * sy;
}

function fbm(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  
  return value / maxValue;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ===================== ГЕНЕРАТОР МИРА =====================

class WorldGenerator {
  scene: THREE.Scene;
  terrain!: THREE.Mesh;
  water!: THREE.Mesh;
  buildings: THREE.Mesh[] = [];
  trees: THREE.InstancedMesh | null = null;
  rocks: THREE.InstancedMesh | null = null;
  checkpoints: THREE.Mesh[] = [];
  enemyBases: THREE.Group[] = [];
  playerBase: THREE.Group | null = null;
  pickups: Pickup[] = [];
  colliders: { position: THREE.Vector3; radius: number; height: number }[] = [];
  
  private quality: string;
  private mapSize = 400;
  private terrainSegments = 100;

  constructor(scene: THREE.Scene, quality: string) {
    this.scene = scene;
    this.quality = quality;
  }

  generate() {
    this.createSky();
    this.createTerrain();
    this.createWater();
    this.createClouds();
    this.createTrees();
    this.createRocks();
    this.createBuildings();
    this.createPlayerBase();
    this.createEnemyBases();
    this.createCheckpoints();
    this.createPickups();
    this.createRoads();
    this.createFences();
    this.createTowers();
    this.createHangars();
    this.setupLighting();
    this.setupFog();
  }

  private createSky() {
    // Градиентное небо через большую сферу
    const skyGeo = new THREE.SphereGeometry(500, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0077ff) },
        bottomColor: { value: new THREE.Color(0xffffff) },
        offset: { value: 20 },
        exponent: { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  private createTerrain() {
    const segments = this.quality === 'low' ? 50 : this.quality === 'medium' ? 100 : 150;
    this.terrainSegments = segments;
    const geo = new THREE.PlaneGeometry(this.mapSize, this.mapSize, segments, segments);
    geo.rotateX(-Math.PI / 2);
    
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      
      // Высота острова — выше в центре, ниже по краям
      const distFromCenter = Math.sqrt(x * x + z * z) / (this.mapSize * 0.5);
      const islandMask = Math.max(0, 1 - distFromCenter * distFromCenter);
      
      // Шум для рельефа
      const height = fbm(x * 0.01, z * 0.01, 4) * 15 * islandMask;
      
      // Плоская зона для базы
      const distFromBase = Math.sqrt((x + 50) * (x + 50) + (z + 50) * (z + 50));
      const baseFlatten = distFromBase < 30 ? Math.max(0, 1 - distFromBase / 30) : 0;
      
      positions.setY(i, height * (1 - baseFlatten * 0.8));
    }
    
    geo.computeVertexNormals();
    
    const mat = new THREE.MeshLambertMaterial({
      color: 0x3d8c40,
      flatShading: this.quality === 'low',
    });
    
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  private createWater() {
    const geo = new THREE.PlaneGeometry(800, 800, 50, 50);
    geo.rotateX(-Math.PI / 2);
    
    const mat = new THREE.MeshPhongMaterial({
      color: 0x006994,
      transparent: true,
      opacity: 0.7,
      shininess: 100,
      specular: 0x444444,
    });
    
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = -1;
    this.scene.add(this.water);
  }

  private createClouds() {
    // Создаём облака из billboard-спрайтов
    const cloudCount = this.quality === 'low' ? 10 : this.quality === 'medium' ? 20 : 30;
    
    for (let i = 0; i < cloudCount; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      
      // Рисуем облако
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      const circles = 5 + Math.floor(Math.random() * 5);
      for (let j = 0; j < circles; j++) {
        const x = 20 + Math.random() * 88;
        const y = 20 + Math.random() * 24;
        const r = 10 + Math.random() * 20;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ 
        map: texture, 
        transparent: true, 
        opacity: 0.7,
        depthWrite: false 
      });
      const sprite = new THREE.Sprite(spriteMat);
      
      const scale = 20 + Math.random() * 30;
      sprite.scale.set(scale, scale * 0.4, 1);
      sprite.position.set(
        randomRange(-200, 200),
        randomRange(40, 70),
        randomRange(-200, 200)
      );
      
      this.scene.add(sprite);
    }
  }

  private createHangars() {
    // Большие металлические ангары
    const hangarPositions = [
      { x: 50, z: -30 },
      { x: -100, z: -80 },
    ];
    
    for (const pos of hangarPositions) {
      const y = this.getTerrainHeight(pos.x, pos.z);
      if (y < 0.5) continue;
      
      const group = new THREE.Group();
      
      // Корпус ангара (полуцилиндр)
      const bodyGeo = new THREE.CylinderGeometry(6, 6, 15, 16, 1, false, 0, Math.PI);
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.rotation.z = Math.PI / 2;
      body.rotation.y = Math.PI / 2;
      body.position.y = 0;
      body.castShadow = true;
      group.add(body);
      
      // Стены
      const wallGeo = new THREE.BoxGeometry(15, 6, 0.3);
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x666666 });
      const wall1 = new THREE.Mesh(wallGeo, wallMat);
      wall1.position.set(0, 3, 6);
      group.add(wall1);
      const wall2 = new THREE.Mesh(wallGeo, wallMat);
      wall2.position.set(0, 3, -6);
      group.add(wall2);
      
      // Ворота
      const doorGeo = new THREE.BoxGeometry(5, 5, 0.2);
      const doorMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position.set(7.5, 2.5, 0);
      door.rotation.y = Math.PI / 2;
      group.add(door);
      
      group.position.set(pos.x, y, pos.z);
      this.scene.add(group);
      
      this.colliders.push({ position: new THREE.Vector3(pos.x, y, pos.z), radius: 8, height: 8 });
    }
  }

  private createTrees() {
    const count = this.quality === 'low' ? 50 : this.quality === 'medium' ? 100 : 150;
    
    // Ствол
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 4, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a2f1a });
    
    // Крона
    const crownGeo = new THREE.ConeGeometry(2.5, 6, 6);
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x2d6b30 });
    
    // Используем InstancedMesh для оптимизации
    this.trees = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crownMesh = new THREE.InstancedMesh(crownGeo, crownMat, count);
    
    const dummy = new THREE.Object3D();
    let placed = 0;
    
    for (let i = 0; i < count * 3 && placed < count; i++) {
      const x = randomRange(-this.mapSize * 0.4, this.mapSize * 0.4);
      const z = randomRange(-this.mapSize * 0.4, this.mapSize * 0.4);
      
      // Не ставить рядом с базой
      const distFromBase = Math.sqrt((x + 50) * (x + 50) + (z + 50) * (z + 50));
      if (distFromBase < 25) continue;
      
      // Проверяем высоту
      const y = this.getTerrainHeight(x, z);
      if (y < 0.5) continue; // Не в воде
      
      const scale = randomRange(0.7, 1.3);
      
      // Ствол
      dummy.position.set(x, y + 2 * scale, z);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();
      this.trees.setMatrixAt(placed, dummy.matrix);
      
      // Крона
      dummy.position.set(x, y + 5.5 * scale, z);
      dummy.updateMatrix();
      crownMesh.setMatrixAt(placed, dummy.matrix);
      
      // Коллайдер
      this.colliders.push({ position: new THREE.Vector3(x, y, z), radius: 1.5 * scale, height: 8 * scale });
      
      placed++;
    }
    
    this.trees.count = placed;
    crownMesh.count = placed;
    this.trees.instanceMatrix.needsUpdate = true;
    crownMesh.instanceMatrix.needsUpdate = true;
    
    this.scene.add(this.trees);
    this.scene.add(crownMesh);
  }

  private createRocks() {
    const count = this.quality === 'low' ? 20 : this.quality === 'medium' ? 40 : 60;
    
    const geo = new THREE.IcosahedronGeometry(1, 1);
    // Деформируем вершины для естественности
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const v = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
      v.multiplyScalar(0.8 + Math.random() * 0.4);
      positions.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    
    const mat = new THREE.MeshLambertMaterial({ color: 0x666666 });
    this.rocks = new THREE.InstancedMesh(geo, mat, count);
    
    const dummy = new THREE.Object3D();
    let placed = 0;
    
    for (let i = 0; i < count * 3 && placed < count; i++) {
      const x = randomRange(-this.mapSize * 0.4, this.mapSize * 0.4);
      const z = randomRange(-this.mapSize * 0.4, this.mapSize * 0.4);
      const y = this.getTerrainHeight(x, z);
      if (y < 0) continue;
      
      const scale = randomRange(0.5, 2.5);
      dummy.position.set(x, y + scale * 0.3, z);
      dummy.scale.set(scale, scale * 0.7, scale);
      dummy.rotation.set(Math.random(), Math.random(), Math.random());
      dummy.updateMatrix();
      this.rocks.setMatrixAt(placed, dummy.matrix);
      
      this.colliders.push({ position: new THREE.Vector3(x, y, z), radius: scale, height: scale });
      placed++;
    }
    
    this.rocks.count = placed;
    this.rocks.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rocks);
  }

  private createBuildings() {
    const buildingPositions = [
      { x: 80, z: 30 }, { x: 100, z: -40 }, { x: -20, z: 80 },
      { x: 60, z: -80 }, { x: -80, z: -30 }, { x: 30, z: 100 },
      { x: -60, z: 60 }, { x: 120, z: 60 },
    ];
    
    for (const pos of buildingPositions) {
      const y = this.getTerrainHeight(pos.x, pos.z);
      if (y < 0.5) continue;
      
      const group = new THREE.Group();
      
      // Основание
      const w = randomRange(6, 12);
      const h = randomRange(4, 10);
      const d = randomRange(6, 12);
      
      const bodyGeo = new THREE.BoxGeometry(w, h, d);
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8B7355 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      
      // Крыша
      const roofGeo = new THREE.ConeGeometry(Math.max(w, d) * 0.7, 3, 4);
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x8B0000 });
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.y = h + 1.5;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(roof);
      
      // Окна
      const windowGeo = new THREE.PlaneGeometry(1.2, 1.5);
      const windowMat = new THREE.MeshBasicMaterial({ color: 0x87CEEB });
      for (let wx = -w/2 + 2; wx < w/2 - 1; wx += 3) {
        for (let wy = 2; wy < h - 1; wy += 3) {
          const win = new THREE.Mesh(windowGeo, windowMat);
          win.position.set(wx, wy, d/2 + 0.01);
          group.add(win);
          
          const win2 = new THREE.Mesh(windowGeo, windowMat);
          win2.position.set(wx, wy, -d/2 - 0.01);
          win2.rotation.y = Math.PI;
          group.add(win2);
        }
      }
      
      group.position.set(pos.x, y, pos.z);
      this.scene.add(group);
      
      // Коллайдер здания
      this.colliders.push({ 
        position: new THREE.Vector3(pos.x, y, pos.z), 
        radius: Math.max(w, d) * 0.6, 
        height: h + 3 
      });
      this.buildings.push(body);
    }
  }

  private createPlayerBase() {
    const group = new THREE.Group();
    const baseX = -50, baseZ = -50;
    const y = this.getTerrainHeight(baseX, baseZ);
    
    // Посадочная площадка
    const padGeo = new THREE.CylinderGeometry(8, 8, 0.3, 32);
    const padMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.15;
    pad.receiveShadow = true;
    group.add(pad);
    
    // Разметка на площадке (крест)
    const lineGeo = new THREE.BoxGeometry(10, 0.05, 0.5);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const line1 = new THREE.Mesh(lineGeo, lineMat);
    line1.position.y = 0.35;
    group.add(line1);
    const line2 = new THREE.Mesh(lineGeo, lineMat);
    line2.position.y = 0.35;
    line2.rotation.y = Math.PI / 2;
    group.add(line2);
    
    // Ангар
    const hangarGeo = new THREE.BoxGeometry(12, 6, 15);
    const hangarMat = new THREE.MeshLambertMaterial({ color: 0x556B2F });
    const hangar = new THREE.Mesh(hangarGeo, hangarMat);
    hangar.position.set(-15, 3, 0);
    hangar.castShadow = true;
    group.add(hangar);
    
    // Крыша ангара (полуцилиндр)
    const roofGeo = new THREE.CylinderGeometry(7.5, 7.5, 15, 16, 1, false, 0, Math.PI);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a5d23 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(-15, 6, 0);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    group.add(roof);
    
    // Заправка (столб с индикатором)
    const fuelGeo = new THREE.CylinderGeometry(0.3, 0.3, 3, 8);
    const fuelMat = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
    const fuel = new THREE.Mesh(fuelGeo, fuelMat);
    fuel.position.set(10, 1.5, 5);
    group.add(fuel);
    
    // Индикатор заправки
    const indicatorGeo = new THREE.SphereGeometry(0.5, 8, 8);
    const indicatorMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    indicator.position.set(10, 3.5, 5);
    group.add(indicator);
    
    group.position.set(baseX, y, baseZ);
    this.scene.add(group);
    this.playerBase = group;
    
    this.colliders.push({ position: new THREE.Vector3(baseX - 15, y, baseZ), radius: 8, height: 9 });
  }

  private createEnemyBases() {
    const basePositions = [
      { x: 100, z: 50, name: 'Alpha' },
      { x: -30, z: 120, name: 'Bravo' },
      { x: 80, z: -100, name: 'Charlie' },
    ];
    
    for (const pos of basePositions) {
      const group = new THREE.Group();
      const y = this.getTerrainHeight(pos.x, pos.z);
      
      // Бункер
      const bunkerGeo = new THREE.BoxGeometry(8, 3, 8);
      const bunkerMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
      const bunker = new THREE.Mesh(bunkerGeo, bunkerMat);
      bunker.position.y = 1.5;
      bunker.castShadow = true;
      group.add(bunker);
      
      // Мешки с песком
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const bagGeo = new THREE.BoxGeometry(2, 0.8, 1);
        const bagMat = new THREE.MeshLambertMaterial({ color: 0x8B7355 });
        const bag = new THREE.Mesh(bagGeo, bagMat);
        bag.position.set(Math.cos(angle) * 6, 0.4, Math.sin(angle) * 6);
        bag.rotation.y = angle;
        group.add(bag);
      }
      
      // Флаг
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 5, 6);
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4;
      group.add(pole);
      
      const flagGeo = new THREE.PlaneGeometry(2, 1.2);
      const flagMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(1, 5.5, 0);
      group.add(flag);
      
      group.position.set(pos.x, y, pos.z);
      this.scene.add(group);
      this.enemyBases.push(group);
      
      this.colliders.push({ position: new THREE.Vector3(pos.x, y, pos.z), radius: 5, height: 5 });
    }
  }

  private createCheckpoints() {
    const checkpointPositions = [
      new THREE.Vector3(0, 30, 0),
      new THREE.Vector3(60, 40, 60),
      new THREE.Vector3(-40, 35, 80),
    ];
    
    for (const pos of checkpointPositions) {
      const ringGeo = new THREE.TorusGeometry(5, 0.3, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      this.checkpoints.push(ring);
    }
  }

  private createPickups() {
    const pickupTypes: Array<{ type: Pickup['type']; value: number }> = [
      { type: 'health', value: 25 },
      { type: 'battery', value: 30 },
      { type: 'bomb', value: 1 },
      { type: 'coins', value: 50 },
    ];
    
    for (let i = 0; i < 12; i++) {
      const x = randomRange(-150, 150);
      const z = randomRange(-150, 150);
      const y = this.getTerrainHeight(x, z) + 2;
      if (y < 1) continue;
      
      const typeInfo = pickupTypes[i % pickupTypes.length];
      const group = new THREE.Group();
      
      let color: number;
      switch (typeInfo.type) {
        case 'health': color = 0xff0000; break;
        case 'battery': color = 0xffff00; break;
        case 'bomb': color = 0xff6600; break;
        case 'coins': color = 0xffd700; break;
      }
      
      const geo = new THREE.OctahedronGeometry(0.8, 0);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      
      // Свечение
      const glowGeo = new THREE.SphereGeometry(1.2, 8, 8);
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      group.add(glow);
      
      group.position.set(x, y, z);
      this.scene.add(group);
      
      this.pickups.push({
        mesh: group,
        position: group.position.clone(),
        type: typeInfo.type,
        value: typeInfo.value,
        collected: false,
        bobTimer: Math.random() * Math.PI * 2,
      });
    }
  }

  private createRoads() {
    // Дорога от базы к вражеским базам
    const roadPoints = [
      { x: -50, z: -50 }, { x: 0, z: -20 }, { x: 50, z: 10 },
      { x: 80, z: 30 }, { x: 100, z: 50 },
    ];
    
    for (let i = 0; i < roadPoints.length - 1; i++) {
      const start = roadPoints[i];
      const end = roadPoints[i + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      
      const roadGeo = new THREE.PlaneGeometry(4, length);
      const roadMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
      const road = new THREE.Mesh(roadGeo, roadMat);
      
      const midX = (start.x + end.x) / 2;
      const midZ = (start.z + end.z) / 2;
      const midY = this.getTerrainHeight(midX, midZ) + 0.05;
      
      road.position.set(midX, midY, midZ);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = -angle;
      road.receiveShadow = true;
      this.scene.add(road);
    }
  }

  private createFences() {
    // Забор вокруг вражеских баз
    for (const base of this.enemyBases) {
      const fenceCount = 12;
      for (let i = 0; i < fenceCount; i++) {
        const angle = (i / fenceCount) * Math.PI * 2;
        const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 2, 4);
        const postMat = new THREE.MeshLambertMaterial({ color: 0x654321 });
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(Math.cos(angle) * 10, 1, Math.sin(angle) * 10);
        base.add(post);
      }
    }
  }

  private createTowers() {
    // Вышки связи
    const towerPositions = [
      { x: 40, z: -60 }, { x: -100, z: 20 }, { x: 120, z: -20 },
    ];
    
    for (const pos of towerPositions) {
      const y = this.getTerrainHeight(pos.x, pos.z);
      if (y < 0.5) continue;
      
      const group = new THREE.Group();
      
      // Мачта
      const mastGeo = new THREE.CylinderGeometry(0.2, 0.4, 20, 4);
      const mastMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      const mast = new THREE.Mesh(mastGeo, mastMat);
      mast.position.y = 10;
      group.add(mast);
      
      // Перекладины
      for (let h = 3; h < 20; h += 4) {
        const crossGeo = new THREE.BoxGeometry(3, 0.15, 0.15);
        const cross = new THREE.Mesh(crossGeo, mastMat);
        cross.position.y = h;
        group.add(cross);
      }
      
      // Антенна наверху
      const antGeo = new THREE.CylinderGeometry(0.05, 0.05, 3, 4);
      const antMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const ant = new THREE.Mesh(antGeo, antMat);
      ant.position.y = 21.5;
      group.add(ant);
      
      // Мигающий огонёк
      const lightGeo = new THREE.SphereGeometry(0.2, 6, 6);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const light = new THREE.Mesh(lightGeo, lightMat);
      light.position.y = 23;
      group.add(light);
      
      group.position.set(pos.x, y, pos.z);
      this.scene.add(group);
      
      this.colliders.push({ position: new THREE.Vector3(pos.x, y, pos.z), radius: 1.5, height: 23 });
    }
  }

  private setupLighting() {
    // Ambient
    const ambient = new THREE.AmbientLight(0x404040, 0.6);
    this.scene.add(ambient);
    
    // Солнце
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(100, 80, 50);
    sun.castShadow = this.quality !== 'low';
    if (sun.castShadow) {
      sun.shadow.mapSize.width = this.quality === 'high' ? 2048 : 1024;
      sun.shadow.mapSize.height = this.quality === 'high' ? 2048 : 1024;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 300;
      sun.shadow.camera.left = -100;
      sun.shadow.camera.right = 100;
      sun.shadow.camera.top = 100;
      sun.shadow.camera.bottom = -100;
    }
    this.scene.add(sun);
    
    // Hemisphere light для более естественного освещения
    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x3d8c40, 0.3);
    this.scene.add(hemi);
  }

  private setupFog() {
    const fogDist = this.quality === 'low' ? 150 : this.quality === 'medium' ? 250 : 400;
    this.scene.fog = new THREE.FogExp2(0x87CEEB, 1 / fogDist);
  }

  getTerrainHeight(x: number, z: number): number {
    const distFromCenter = Math.sqrt(x * x + z * z) / (this.mapSize * 0.5);
    const islandMask = Math.max(0, 1 - distFromCenter * distFromCenter);
    const height = fbm(x * 0.01, z * 0.01, 4) * 15 * islandMask;
    
    const distFromBase = Math.sqrt((x + 50) * (x + 50) + (z + 50) * (z + 50));
    const baseFlatten = distFromBase < 30 ? Math.max(0, 1 - distFromBase / 30) : 0;
    
    return height * (1 - baseFlatten * 0.8);
  }

  updateWater(time: number) {
    if (!this.water) return;
    const positions = this.water.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = Math.sin(x * 0.05 + time) * 0.3 + Math.cos(z * 0.05 + time * 0.7) * 0.2;
      positions.setY(i, y - 1);
    }
    positions.needsUpdate = true;
  }

  updateCheckpoints(time: number) {
    for (const cp of this.checkpoints) {
      cp.rotation.z = time * 0.5;
    }
  }

  updatePickups(time: number) {
    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      pickup.bobTimer += 0.02;
      pickup.mesh.position.y = pickup.position.y + Math.sin(pickup.bobTimer) * 0.5;
      pickup.mesh.rotation.y = time;
    }
  }
}

// ===================== МОДЕЛЬ ДРОНА =====================

class DroneModel {
  group: THREE.Group;
  rotors: THREE.Mesh[] = [];
  body: THREE.Mesh;
  camera: THREE.Mesh;
  damagedSmoke: THREE.Points | null = null;
  trail: THREE.Line | null = null;
  trailPositions: number[] = [];

  constructor() {
    this.group = new THREE.Group();
    
    // Корпус
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.2, 0.8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.castShadow = true;
    this.group.add(this.body);
    
    // Руки (лучи) к моторам
    const armGeo = new THREE.BoxGeometry(1.2, 0.08, 0.08);
    const armMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    
    const arm1 = new THREE.Mesh(armGeo, armMat);
    arm1.rotation.y = Math.PI / 4;
    this.group.add(arm1);
    
    const arm2 = new THREE.Mesh(armGeo, armMat);
    arm2.rotation.y = -Math.PI / 4;
    this.group.add(arm2);
    
    // Моторы и пропеллеры
    const motorPositions = [
      { x: 0.5, z: 0.5 }, { x: -0.5, z: 0.5 },
      { x: 0.5, z: -0.5 }, { x: -0.5, z: -0.5 },
    ];
    
    for (const pos of motorPositions) {
      const motorGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.15, 8);
      const motorMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
      const motor = new THREE.Mesh(motorGeo, motorMat);
      motor.position.set(pos.x, 0.1, pos.z);
      this.group.add(motor);
      
      // Пропеллер
      const propGeo = new THREE.BoxGeometry(0.6, 0.02, 0.05);
      const propMat = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.7 });
      const prop = new THREE.Mesh(propGeo, propMat);
      prop.position.set(pos.x, 0.2, pos.z);
      this.group.add(prop);
      this.rotors.push(prop);
    }
    
    // Камера FPV
    const camGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const camMat = new THREE.MeshBasicMaterial({ color: 0x00aaff });
    this.camera = new THREE.Mesh(camGeo, camMat);
    this.camera.position.set(0, -0.05, 0.45);
    this.group.add(this.camera);
    
    // LED индикаторы
    const ledGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const ledMatGreen = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const ledMatRed = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    
    const ledFront = new THREE.Mesh(ledGeo, ledMatGreen);
    ledFront.position.set(0, 0, 0.42);
    this.group.add(ledFront);
    
    const ledBack = new THREE.Mesh(ledGeo, ledMatRed);
    ledBack.position.set(0, 0, -0.42);
    this.group.add(ledBack);
    
    // Trail (след)
    const trailGeo = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(300); // 100 точек * 3 координаты
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5 });
    this.trail = new THREE.Line(trailGeo, trailMat);
    this.trailPositions = [];
  }

  updateRotors(time: number, throttle: number) {
    const speed = 20 + throttle * 50;
    for (let i = 0; i < this.rotors.length; i++) {
      this.rotors[i].rotation.y = time * speed * (i % 2 === 0 ? 1 : -1);
    }
  }

  updateTrail(position: THREE.Vector3, speed: number) {
    if (speed > 5) {
      this.trailPositions.push(position.x, position.y, position.z);
      if (this.trailPositions.length > 300) {
        this.trailPositions.splice(0, 3);
      }
    }
    
    if (this.trail && this.trailPositions.length >= 6) {
      const arr = new Float32Array(this.trailPositions);
      this.trail.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      this.trail.geometry.attributes.position.needsUpdate = true;
    }
  }

  showDamage(damaged: boolean) {
    if (damaged && !this.damagedSmoke) {
      // Создаём дым
      const smokeGeo = new THREE.BufferGeometry();
      const smokePositions = new Float32Array(30);
      for (let i = 0; i < 30; i += 3) {
        smokePositions[i] = (Math.random() - 0.5) * 0.3;
        smokePositions[i + 1] = Math.random() * 0.5;
        smokePositions[i + 2] = (Math.random() - 0.5) * 0.3;
      }
      smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
      const smokeMat = new THREE.PointsMaterial({ color: 0x444444, size: 0.2, transparent: true, opacity: 0.6 });
      this.damagedSmoke = new THREE.Points(smokeGeo, smokeMat);
      this.group.add(this.damagedSmoke);
    } else if (!damaged && this.damagedSmoke) {
      this.group.remove(this.damagedSmoke);
      this.damagedSmoke = null;
    }
  }
}

// ===================== СИСТЕМА ЧАСТИЦ =====================

class ParticleSystem {
  particles: Particle[] = [];
  pool: Particle[] = [];
  scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  emit(position: THREE.Vector3, count: number, color: number, speed: number, lifetime: number, gravity: boolean = true) {
    for (let i = 0; i < count; i++) {
      let particle: Particle;
      
      if (this.pool.length > 0) {
        particle = this.pool.pop()!;
        particle.mesh.material = new THREE.MeshBasicMaterial({ color });
        particle.mesh.position.copy(position);
        particle.mesh.visible = true;
        (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      } else {
        const geo = new THREE.SphereGeometry(0.1, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        this.scene.add(mesh);
        particle = { mesh, velocity: new THREE.Vector3(), lifetime: 0, maxLifetime: 0, gravity: true, scale: 1 };
      }
      
      particle.velocity.set(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.5,
        (Math.random() - 0.5) * speed
      );
      particle.lifetime = lifetime;
      particle.maxLifetime = lifetime;
      particle.gravity = gravity;
      particle.scale = 0.5 + Math.random() * 0.5;
      
      this.particles.push(particle);
    }
  }

  emitExplosion(position: THREE.Vector3, size: number = 1) {
    // Огонь
    this.emit(position, Math.floor(20 * size), 0xff4400, 8 * size, 0.8, true);
    // Искры
    this.emit(position, Math.floor(15 * size), 0xffff00, 12 * size, 0.5, true);
    // Дым
    this.emit(position, Math.floor(10 * size), 0x333333, 4 * size, 2.0, false);
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.lifetime -= dt;
      
      if (p.lifetime <= 0) {
        p.mesh.visible = false;
        this.pool.push(p);
        this.particles.splice(i, 1);
        continue;
      }
      
      // Обновляем позицию
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
      
      // Гравитация
      if (p.gravity) {
        p.velocity.y -= 9.81 * dt;
      }
      
      // Затухание
      const alpha = p.lifetime / p.maxLifetime;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
      p.mesh.scale.setScalar(p.scale * alpha);
    }
  }
}

// ===================== ОСНОВНОЙ ДВИЖОК =====================

export class GameEngine {
  // Three.js
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  
  // Системы
  world: WorldGenerator;
  droneModel: DroneModel;
  particles: ParticleSystem;
  
  // Состояние
  settings: GameSettings;
  state: GameState;
  drone: DroneState;
  
  // Враги и снаряды
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  
  // Управление
  keys: { [key: string]: boolean } = {};
  mouseX = 0;
  mouseY = 0;
  mouseLocked = false;
  gamepadIndex: number | null = null;
  
  // Камера
  cameraMode: 'fpv' | 'chase' | 'orbit' | 'free' | 'cockpit' = 'fpv';
  cameraTarget = new THREE.Vector3();
  cameraOffset = new THREE.Vector3(0, 2, 5);
  freeCamPos = new THREE.Vector3(0, 20, 0);
  freeCamRot = new THREE.Euler(0, 0, 0);
  orbitAngle = 0;
  
  // Время
  clock: THREE.Clock;
  gameTime = 0;
  deltaTime = 0;
  
  // Ветер
  wind = new THREE.Vector3(0, 0, 0);
  windTarget = new THREE.Vector3(0, 0, 0);
  windTimer = 0;
  
  // FPV эффекты
  fpvCanvas: HTMLCanvasElement;
  fpvContext: CanvasRenderingContext2D;
  fpvTexture: THREE.CanvasTexture;
  fpvOverlay: THREE.Mesh;
  
  // Callbacks для UI
  onStateChange: ((state: GameState) => void) | null = null;
  
  // Физика
  private gravity = 9.81;
  private dragCoeff = 0.3;
  private angularDrag = 2.0;
  private maxThrust = 25;
  private motorPositions = [
    new THREE.Vector3(0.5, 0, 0.5),
    new THREE.Vector3(-0.5, 0, 0.5),
    new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(-0.5, 0, -0.5),
  ];
  
  // База
  basePosition = new THREE.Vector3(-50, 2, -50);
  
  // Анимация
  animationId: number | null = null;
  running = false;
  private notifyCounter = 0;
  private readonly NOTIFY_INTERVAL = 3; // Уведомляем UI каждые N кадров

  constructor(container: HTMLElement, settings: GameSettings) {
    this.settings = settings;
    this.clock = new THREE.Clock();
    
    // Рендерер
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality !== 'low' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality === 'low' ? 1 : 2));
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    
    // Сцена
    this.scene = new THREE.Scene();
    
    // Камера
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // Мир
    this.world = new WorldGenerator(this.scene, settings.quality);
    this.world.generate();
    
    // Модель дрона
    this.droneModel = new DroneModel();
    this.scene.add(this.droneModel.group);
    if (this.droneModel.trail) {
      this.scene.add(this.droneModel.trail);
    }
    
    // Частицы
    this.particles = new ParticleSystem(this.scene);
    
    // FPV оверлей
    this.fpvCanvas = document.createElement('canvas');
    this.fpvCanvas.width = 256;
    this.fpvCanvas.height = 256;
    this.fpvContext = this.fpvCanvas.getContext('2d')!;
    this.fpvTexture = new THREE.CanvasTexture(this.fpvCanvas);
    const fpvGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const fpvMat = new THREE.MeshBasicMaterial({ 
      map: this.fpvTexture, 
      transparent: true, 
      opacity: 0.3,
      side: THREE.BackSide 
    });
    this.fpvOverlay = new THREE.Mesh(fpvGeo, fpvMat);
    this.fpvOverlay.visible = false;
    this.scene.add(this.fpvOverlay);
    
    // Состояние дрона
    this.drone = {
      position: new THREE.Vector3(-50, 5, -50),
      velocity: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      angularVelocity: new THREE.Vector3(0, 0, 0),
      throttle: 0,
      roll: 0,
      pitch: 0,
      yaw: 0,
      damaged: false,
      motorHealth: [100, 100, 100, 100],
      overheated: false,
    };
    
    // Игровое состояние
    this.state = {
      phase: 'menu',
      currentMission: 0,
      score: 0,
      coins: 0,
      time: 0,
      droneHP: 100,
      droneMaxHP: 100,
      battery: 100,
      bombs: 3,
      maxBombs: 3,
      cameraMode: 'fpv',
      missionObjectives: [],
      warnings: [],
      kills: 0,
      accuracy: 0,
      shotsFired: 0,
      shotsHit: 0,
      stars: 0,
      upgrades: {
        maxHP: 0,
        batteryCapacity: 0,
        bombDamage: 0,
        repairSpeed: 0,
        stealth: 0,
        extraBombs: 0,
      },
      droneAlt: 0,
      droneSpeed: 0,
      droneThrottle: 0,
    };
    
    // Обработчики событий
    this.setupInput();
    
    // Ресайз
    window.addEventListener('resize', () => this.onResize());
  }

  // ===================== УПРАВЛЕНИЕ =====================
  
  private setupInput() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      
      if (e.code === 'Escape' && this.state.phase === 'playing') {
        this.pause();
      } else if (e.code === 'Escape' && this.state.phase === 'paused') {
        this.resume();
      }
      
      if (e.code === 'KeyC' && this.state.phase === 'playing') {
        this.cycleCamera();
      }
      
      if (e.code === 'KeyF' && this.state.phase === 'playing') {
        this.resetToBase();
      }
      
      if (e.code === 'KeyR' && this.state.phase === 'playing') {
        this.resetCamera();
      }
    });
    
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (this.mouseLocked && this.state.phase === 'playing') {
        this.mouseX += e.movementX * this.settings.mouseSensX * 0.001;
        this.mouseY += e.movementY * this.settings.mouseSensY * 0.001;
      }
    });
    
    document.addEventListener('mousedown', (e) => {
      if (this.state.phase === 'playing') {
        if (e.button === 0) { // ЛКМ — бомба
          this.dropBomb();
        } else if (e.button === 2) { // ПКМ — камикадзе
          this.kamikaze();
        }
      }
    });
    
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Запрос pointer lock при клике на canvas
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state.phase === 'playing' && !this.mouseLocked) {
        this.renderer.domElement.requestPointerLock();
      }
    });
    
    document.addEventListener('pointerlockchange', () => {
      this.mouseLocked = document.pointerLockElement === this.renderer.domElement;
    });
    
    // Геймпад
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  private readGamepad() {
    if (this.gamepadIndex === null) return;
    const gamepads = navigator.getGamepads();
    const gp = gamepads[this.gamepadIndex];
    if (!gp) return;
    
    const deadzone = 0.15;
    
    // Левый стик — тяга + рыскание
    const lx = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
    const ly = Math.abs(gp.axes[1]) > deadzone ? gp.axes[1] : 0;
    
    // Правый стик — тангаж + крен
    const rx = Math.abs(gp.axes[2]) > deadzone ? gp.axes[2] : 0;
    const ry = Math.abs(gp.axes[3]) > deadzone ? gp.axes[3] : 0;
    
    // Применяем как дополнительные входы
    this.drone.yaw += lx * 0.02;
    this.drone.throttle = Math.max(0, Math.min(1, this.drone.throttle - ly * 0.02));
    this.drone.roll += rx * 0.03;
    this.drone.pitch += ry * 0.03;
  }

  // ===================== КАМЕРЫ =====================
  
  cycleCamera() {
    const modes: Array<typeof this.cameraMode> = ['fpv', 'chase', 'orbit', 'free', 'cockpit'];
    const idx = modes.indexOf(this.cameraMode);
    this.cameraMode = modes[(idx + 1) % modes.length];
    this.state.cameraMode = this.cameraMode;
    this.notifyState();
  }

  resetCamera() {
    this.mouseX = 0;
    this.mouseY = 0;
  }

  private updateCamera() {
    const dronePos = this.drone.position;
    
    switch (this.cameraMode) {
      case 'fpv': {
        // FPV камера — от первого лица с эффектами
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.drone.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.drone.quaternion);
        
        this.camera.position.copy(dronePos).add(forward.clone().multiplyScalar(0.3));
        this.camera.position.add(up.clone().multiplyScalar(0.1));
        
        const lookTarget = dronePos.clone().add(forward.clone().multiplyScalar(10));
        this.camera.lookAt(lookTarget);
        
        // Применяем поворот мыши
        this.camera.rotateY(-this.mouseX * 0.5);
        this.camera.rotateX(-this.mouseY * 0.5 * (this.settings.invertY ? -1 : 1));
        
        // FOV эффект скорости
        const speed = this.drone.velocity.length();
        this.camera.fov = 75 + speed * 0.5;
        this.camera.updateProjectionMatrix();
        break;
      }
      
      case 'chase': {
        // Камера позади дрона
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.drone.quaternion);
        const targetPos = dronePos.clone().add(back.multiplyScalar(8)).add(new THREE.Vector3(0, 3, 0));
        
        this.camera.position.lerp(targetPos, 0.05);
        this.cameraTarget.lerp(dronePos, 0.1);
        this.camera.lookAt(this.cameraTarget);
        break;
      }
      
      case 'orbit': {
        // Вращается вокруг дрона
        this.orbitAngle += this.deltaTime * 0.3;
        const orbitPos = new THREE.Vector3(
          dronePos.x + Math.cos(this.orbitAngle) * 12,
          dronePos.y + 5,
          dronePos.z + Math.sin(this.orbitAngle) * 12
        );
        this.camera.position.lerp(orbitPos, 0.05);
        this.camera.lookAt(dronePos);
        break;
      }
      
      case 'free': {
        // Свободная камера
        const moveSpeed = 20 * this.deltaTime;
        const forward = new THREE.Vector3(0, 0, -1).applyEuler(this.freeCamRot);
        const right = new THREE.Vector3(1, 0, 0).applyEuler(this.freeCamRot);
        
        if (this.keys['KeyW']) this.freeCamPos.add(forward.multiplyScalar(moveSpeed));
        if (this.keys['KeyS']) this.freeCamPos.add(forward.multiplyScalar(-moveSpeed));
        if (this.keys['KeyA']) this.freeCamPos.add(right.multiplyScalar(-moveSpeed));
        if (this.keys['KeyD']) this.freeCamPos.add(right.multiplyScalar(moveSpeed));
        if (this.keys['Space']) this.freeCamPos.y += moveSpeed;
        if (this.keys['ShiftLeft']) this.freeCamPos.y -= moveSpeed;
        
        this.freeCamRot.y -= this.mouseX * 0.3;
        this.freeCamRot.x -= this.mouseY * 0.3 * (this.settings.invertY ? -1 : 1);
        this.freeCamRot.x = clamp(this.freeCamRot.x, -Math.PI / 2, Math.PI / 2);
        
        this.camera.position.copy(this.freeCamPos);
        this.camera.rotation.copy(this.freeCamRot);
        break;
      }
      
      case 'cockpit': {
        // Вид от носа
        const noseForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.drone.quaternion);
        this.camera.position.copy(dronePos).add(noseForward.clone().multiplyScalar(0.5));
        const lookAt = dronePos.clone().add(noseForward.clone().multiplyScalar(50));
        this.camera.lookAt(lookAt);
        break;
      }
    }
    
    // Сбрасываем накопленное смещение мыши для не-FPV режимов
    if (this.cameraMode !== 'fpv' && this.cameraMode !== 'free') {
      this.mouseX *= 0.9;
      this.mouseY *= 0.9;
    }
  }

  // ===================== ФИЗИКА ДРОНА =====================
  
  private updateDronePhysics(dt: number) {
    if (this.state.phase !== 'playing') return;
    
    const d = this.drone;
    
    // === Ввод ===
    // Тяга
    if (this.keys['KeyW']) d.throttle = Math.min(1, d.throttle + dt * 1.5);
    if (this.keys['KeyS']) d.throttle = Math.max(0, d.throttle - dt * 1.5);
    
    // Крен
    if (this.keys['KeyA']) d.roll -= dt * 3;
    if (this.keys['KeyD']) d.roll += dt * 3;
    d.roll *= (1 - dt * 3); // Возврат в нейтраль
    
    // Тангаж (мышь)
    d.pitch -= this.mouseY * 0.1 * (this.settings.invertY ? -1 : 1);
    this.mouseY *= 0.85; // Затухание
    d.pitch *= (1 - dt * 2);
    
    // Рыскание
    if (this.keys['KeyQ']) d.yaw -= dt * 2;
    if (this.keys['KeyE']) d.yaw += dt * 2;
    if (this.keys['Space']) d.throttle = Math.min(1, d.throttle + dt * 2);
    if (this.keys['ShiftLeft']) d.throttle = Math.max(0, d.throttle - dt * 2);
    
    // Геймпад
    this.readGamepad();
    
    // === Обновление ориентации ===
    d.angularVelocity.x = d.pitch * 3; // Тангаж
    d.angularVelocity.y = d.yaw * 2; // Рыскание
    d.angularVelocity.z = d.roll * 3; // Крен
    
    // Угловое затухание
    d.angularVelocity.multiplyScalar(1 - this.angularDrag * dt);
    
    // Применяем вращение через кватернионы
    const deltaRot = new THREE.Quaternion();
    const euler = new THREE.Euler(
      d.angularVelocity.x * dt,
      d.angularVelocity.y * dt,
      d.angularVelocity.z * dt,
      'YXZ'
    );
    deltaRot.setFromEuler(euler);
    d.quaternion.multiply(deltaRot);
    d.quaternion.normalize();
    
    // === Тяга ===
    const thrust = d.throttle * this.maxThrust;
    const thrustDir = new THREE.Vector3(0, 1, 0).applyQuaternion(d.quaternion);
    const thrustForce = thrustDir.multiplyScalar(thrust);
    
    // Повреждения моторов влияют на тягу
    const avgMotorHealth = d.motorHealth.reduce((a, b) => a + b, 0) / 4;
    thrustForce.multiplyScalar(avgMotorHealth / 100);
    
    // === Гравитация ===
    const gravityForce = new THREE.Vector3(0, -this.gravity, 0);
    
    // === Сопротивление воздуха ===
    const dragForce = d.velocity.clone().multiplyScalar(-this.dragCoeff);
    
    // === Ветер ===
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTarget.set(
        (Math.random() - 0.5) * 5,
        0,
        (Math.random() - 0.5) * 5
      );
      this.windTimer = 3 + Math.random() * 5;
    }
    this.wind.lerp(this.windTarget, dt * 0.5);
    const windForce = this.wind.clone().multiplyScalar(0.5);
    
    // === Турбулентность ===
    const turbulence = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5 * d.throttle,
      (Math.random() - 0.5) * 0.3 * d.throttle,
      (Math.random() - 0.5) * 0.5 * d.throttle
    );
    
    // === Суммарная сила ===
    const totalForce = new THREE.Vector3();
    totalForce.add(thrustForce);
    totalForce.add(gravityForce);
    totalForce.add(dragForce);
    totalForce.add(windForce);
    totalForce.add(turbulence);
    
    // === Интеграция ===
    const mass = 1.5; // кг
    const acceleration = totalForce.divideScalar(mass);
    d.velocity.add(acceleration.multiplyScalar(dt));
    d.position.add(d.velocity.clone().multiplyScalar(dt));
    
    // === Коллизия с землёй ===
    const terrainH = this.world.getTerrainHeight(d.position.x, d.position.z);
    if (d.position.y < terrainH + 0.5) {
      const impactSpeed = Math.abs(d.velocity.y);
      d.position.y = terrainH + 0.5;
      
      if (impactSpeed > 5) {
        // Критическое повреждение
        this.damageDrone(impactSpeed * 5);
        this.particles.emitExplosion(d.position.clone(), 0.5);
        audioManager.playHit();
      }
      
      d.velocity.y = Math.max(0, d.velocity.y);
      d.velocity.x *= 0.9;
      d.velocity.z *= 0.9;
    }
    
    // === Коллизия с объектами ===
    for (const col of this.world.colliders) {
      const dist = distanceXZ(d.position, col.position);
      if (dist < col.radius + 1 && d.position.y < col.position.y + col.height) {
        // Отталкивание
        const pushDir = new THREE.Vector3(
          d.position.x - col.position.x,
          0,
          d.position.z - col.position.z
        ).normalize();
        
        const impactSpeed = d.velocity.length();
        d.position.add(pushDir.multiplyScalar(col.radius + 1 - dist));
        
        if (impactSpeed > 8) {
          // Потеря мотора
          const deadMotor = Math.floor(Math.random() * 4);
          d.motorHealth[deadMotor] = Math.max(0, d.motorHealth[deadMotor] - 50);
          this.damageDrone(20);
          audioManager.playHit();
        }
        
        d.velocity.multiplyScalar(0.5);
      }
    }
    
    // === Границы карты ===
    const mapBound = this.world['mapSize'] * 0.48;
    d.position.x = clamp(d.position.x, -mapBound, mapBound);
    d.position.z = clamp(d.position.z, -mapBound, mapBound);
    d.position.y = Math.max(0.5, Math.min(d.position.y, 150));
    
    // === Батарея ===
    const batteryDrain = d.throttle * 3 * dt;
    this.state.battery = Math.max(0, this.state.battery - batteryDrain);
    
    // === Перегрев ===
    if (d.throttle > 0.9) {
      d.overheated = true;
    } else {
      d.overheated = false;
    }
    
    // === Обновление модели ===
    this.droneModel.group.position.copy(d.position);
    this.droneModel.group.quaternion.copy(d.quaternion);
    this.droneModel.updateRotors(this.gameTime, d.throttle);
    this.droneModel.showDamage(d.damaged);
    
    const speed = d.velocity.length();
    this.droneModel.updateTrail(d.position, speed);
    
    // === Предупреждения ===
    this.state.warnings = [];
    if (this.state.battery < 20) {
      this.state.warnings.push('НИЗКАЯ БАТАРЕЯ');
    }
    if (d.damaged) {
      this.state.warnings.push('ПОВРЕЖДЕНИЕ');
    }
    if (d.overheated) {
      this.state.warnings.push('ПЕРЕГРЕВ');
    }
    
    // === Зарядка на базе ===
    const distToBase = distanceXZ(d.position, this.basePosition);
    if (distToBase < 10 && d.position.y < 4) {
      this.state.battery = Math.min(100, this.state.battery + dt * 20);
      if (d.damaged) {
        const repairRate = 10 + this.state.upgrades.repairSpeed * 5;
        this.state.droneHP = Math.min(this.state.droneMaxHP, this.state.droneHP + dt * repairRate);
        if (this.state.droneHP >= this.state.droneMaxHP) {
          d.damaged = false;
          d.motorHealth = [100, 100, 100, 100];
        }
      }
    }
    
    // === Подбор бонусов ===
    for (const pickup of this.world.pickups) {
      if (pickup.collected) continue;
      const dist = d.position.distanceTo(pickup.position);
      if (dist < 3) {
        pickup.collected = true;
        pickup.mesh.visible = false;
        audioManager.playPickup();
        
        switch (pickup.type) {
          case 'health':
            this.state.droneHP = Math.min(this.state.droneMaxHP, this.state.droneHP + pickup.value);
            break;
          case 'battery':
            this.state.battery = Math.min(100, this.state.battery + pickup.value);
            break;
          case 'bomb':
            this.state.bombs = Math.min(this.state.maxBombs, this.state.bombs + pickup.value);
            break;
          case 'coins':
            this.state.coins += pickup.value;
            break;
        }
      }
    }
    
    // === Проверка смерти ===
    if (this.state.droneHP <= 0 || this.state.battery <= 0) {
      this.state.phase = 'defeat';
      this.running = false;
      this.notifyState();
    }
  }

  damageDrone(amount: number) {
    this.state.droneHP = Math.max(0, this.state.droneHP - amount);
    if (this.state.droneHP < 50) {
      this.drone.damaged = true;
    }
    audioManager.playHit();
    this.notifyState();
  }

  resetToBase() {
    this.drone.position.set(-50, 5, -50);
    this.drone.velocity.set(0, 0, 0);
    this.drone.quaternion.identity();
    this.drone.angularVelocity.set(0, 0, 0);
    this.drone.throttle = 0;
    this.drone.damaged = false;
    this.drone.motorHealth = [100, 100, 100, 100];
    this.state.battery = 100;
    this.state.droneHP = this.state.droneMaxHP;
  }

  // ===================== ОРУЖИЕ =====================
  
  dropBomb() {
    if (this.state.bombs <= 0 || this.state.phase !== 'playing') return;
    this.state.bombs--;
    
    const bombMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.1, 0.6, 8),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    bombMesh.position.copy(this.drone.position);
    this.scene.add(bombMesh);
    
    // Оперение
    const finGeo = new THREE.BoxGeometry(0.4, 0.02, 0.15);
    const finMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.y = 0.2;
    bombMesh.add(fin);
    const fin2 = new THREE.Mesh(finGeo, finMat);
    fin2.position.y = 0.2;
    fin2.rotation.y = Math.PI / 2;
    bombMesh.add(fin2);
    
    const projectile: Projectile = {
      mesh: bombMesh,
      position: this.drone.position.clone(),
      velocity: this.drone.velocity.clone().add(new THREE.Vector3(0, -2, 0)),
      damage: 50 + this.state.upgrades.bombDamage * 15,
      lifetime: 10,
      type: 'bomb',
      owner: 'player',
    };
    
    this.projectiles.push(projectile);
    this.state.shotsFired++;
    audioManager.playShot();
    this.notifyState();
  }

  kamikaze() {
    if (this.state.phase !== 'playing') return;
    
    // Дрон летит вперёд как снаряд
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.drone.quaternion);
    this.drone.velocity.copy(forward.multiplyScalar(40));
    this.drone.throttle = 1;
    
    // Устанавливаем таймер самоуничтожения
    setTimeout(() => {
      if (this.state.phase === 'playing') {
        // Взрыв
        this.particles.emitExplosion(this.drone.position.clone(), 2);
        audioManager.playExplosion(2);
        
        // Урон врагам в радиусе
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          const dist = enemy.position.distanceTo(this.drone.position);
          if (dist < 15) {
            const dmg = 100 * (1 - dist / 15);
            enemy.hp -= dmg;
            if (enemy.hp <= 0) {
              this.killEnemy(enemy);
            }
          }
        }
        
        // Дрон уничтожен
        this.state.droneHP = 0;
        this.droneModel.group.visible = false;
        
        // Респавн через 3 секунды
        setTimeout(() => {
          this.droneModel.group.visible = true;
          this.resetToBase();
          this.notifyState();
        }, 3000);
        
        this.notifyState();
      }
    }, 1500);
  }

  // ===================== СНАРЯДЫ =====================
  
  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.lifetime -= dt;
      
      if (p.lifetime <= 0) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      
      // Гравитация для бомб
      if (p.type === 'bomb') {
        p.velocity.y -= this.gravity * dt;
      }
      
      // Самонаведение для ракет
      if (p.type === 'rocket' && p.target) {
        const toTarget = p.target.clone().sub(p.position).normalize();
        p.velocity.lerp(toTarget.multiplyScalar(25), dt * 2);
      }
      
      // Обновляем позицию
      p.position.add(p.velocity.clone().multiplyScalar(dt));
      p.mesh.position.copy(p.position);
      
      // Поворот ракеты/бомбы
      if (p.type === 'rocket' || p.type === 'bomb') {
        const dir = p.velocity.clone().normalize();
        p.mesh.lookAt(p.position.clone().add(dir));
      }
      
      // Коллизия с землёй
      const terrainH = this.world.getTerrainHeight(p.position.x, p.position.z);
      if (p.position.y < terrainH) {
        if (p.type === 'bomb' || p.type === 'rocket') {
          this.explodeProjectile(p);
        }
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      
      // Коллизия с врагами (для снарядов игрока)
      if (p.owner === 'player') {
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          const dist = p.position.distanceTo(enemy.position);
          if (dist < 3) {
            if (p.type === 'bomb' || p.type === 'rocket') {
              this.explodeProjectile(p);
            } else {
              enemy.hp -= p.damage;
              this.state.shotsHit++;
              audioManager.playHit();
              if (enemy.hp <= 0) {
                this.killEnemy(enemy);
              }
            }
            this.scene.remove(p.mesh);
            this.projectiles.splice(i, 1);
            break;
          }
        }
      }
      
      // Коллизия с дроном (для снарядов врагов)
      if (p.owner === 'enemy') {
        const dist = p.position.distanceTo(this.drone.position);
        if (dist < 2) {
          this.damageDrone(p.damage);
          this.particles.emit(p.position.clone(), 5, 0xffaa00, 3, 0.3);
          this.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  private explodeProjectile(p: Projectile) {
    const radius = p.type === 'bomb' ? 8 : 6;
    const damage = p.damage;
    
    this.particles.emitExplosion(p.position.clone(), p.type === 'bomb' ? 1.5 : 1);
    audioManager.playExplosion(p.type === 'bomb' ? 1.5 : 1);
    
    // Урон врагам в радиусе
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dist = enemy.position.distanceTo(p.position);
      if (dist < radius) {
        const dmg = damage * (1 - dist / radius);
        enemy.hp -= dmg;
        if (enemy.hp <= 0) {
          this.killEnemy(enemy);
        }
      }
    }
    
    this.state.shotsHit++;
  }

  // ===================== ВРАГИ =====================
  
  spawnEnemies(missionIndex: number) {
    // Удаляем старых
    for (const e of this.enemies) {
      this.scene.remove(e.mesh);
    }
    this.enemies = [];
    
    const mission = MISSIONS[missionIndex];
    if (!mission) return;
    
    for (const type of mission.enemies) {
      this.createEnemy(type as Enemy['type']);
    }
  }

  private createEnemy(type: Enemy['type']): Enemy {
    const group = new THREE.Group();
    let hp = 30;
    let detectionRange = 40;
    let attackRange = 30;
    let speed = 3;
    
    switch (type) {
      case 'soldier': {
        // Тело
        const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.5, 8);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x556B2F });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1;
        group.add(body);
        
        // Голова
        const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xDEB887 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 2;
        group.add(head);
        
        // Оружие
        const gunGeo = new THREE.BoxGeometry(0.1, 0.1, 0.8);
        const gunMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const gun = new THREE.Mesh(gunGeo, gunMat);
        gun.position.set(0.3, 1.2, 0.3);
        group.add(gun);
        
        hp = 30;
        detectionRange = 35;
        attackRange = 30;
        speed = 2;
        break;
      }
      
      case 'aagun': {
        // База
        const baseGeo = new THREE.CylinderGeometry(1.5, 2, 1, 8);
        const baseMat = new THREE.MeshLambertMaterial({ color: 0x4a5d23 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.5;
        group.add(base);
        
        // Турель
        const turretGeo = new THREE.BoxGeometry(1.2, 0.6, 1.5);
        const turretMat = new THREE.MeshLambertMaterial({ color: 0x556B2F });
        const turret = new THREE.Mesh(turretGeo, turretMat);
        turret.position.y = 1.3;
        group.add(turret);
        
        // Стволы
        const barrelGeo = new THREE.CylinderGeometry(0.08, 0.08, 2, 6);
        const barrelMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const barrel1 = new THREE.Mesh(barrelGeo, barrelMat);
        barrel1.rotation.x = Math.PI / 2;
        barrel1.position.set(0.3, 1.3, 1.5);
        group.add(barrel1);
        const barrel2 = new THREE.Mesh(barrelGeo, barrelMat);
        barrel2.rotation.x = Math.PI / 2;
        barrel2.position.set(-0.3, 1.3, 1.5);
        group.add(barrel2);
        
        hp = 100;
        detectionRange = 60;
        attackRange = 50;
        speed = 0;
        break;
      }
      
      case 'rocket': {
        // Солдат с ракетницей
        const bodyGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8B0000 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1;
        group.add(body);
        
        const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
        const headMat = new THREE.MeshLambertMaterial({ color: 0xDEB887 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 2.1;
        group.add(head);
        
        // Ракетная труба
        const tubeGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8);
        const tubeMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        tube.rotation.x = Math.PI / 4;
        tube.position.set(0.4, 1.5, 0.3);
        group.add(tube);
        
        hp = 50;
        detectionRange = 50;
        attackRange = 60;
        speed = 1.5;
        break;
      }
      
      case 'drone': {
        // Вражеский дрон
        const bodyGeo = new THREE.BoxGeometry(0.6, 0.15, 0.6);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8B0000 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        group.add(body);
        
        // Руки
        const armGeo = new THREE.BoxGeometry(1, 0.05, 0.05);
        const armMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
        const arm1 = new THREE.Mesh(armGeo, armMat);
        arm1.rotation.y = Math.PI / 4;
        group.add(arm1);
        const arm2 = new THREE.Mesh(armGeo, armMat);
        arm2.rotation.y = -Math.PI / 4;
        group.add(arm2);
        
        hp = 40;
        detectionRange = 50;
        attackRange = 5; // Таран
        speed = 8;
        break;
      }
      
      case 'boss': {
        // Большой гексакоптер
        const bodyGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.5, 6);
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x4a0000 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        group.add(body);
        
        // 6 моторов
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2;
          const armGeo = new THREE.BoxGeometry(0.1, 0.1, 2);
          const armMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
          const arm = new THREE.Mesh(armGeo, armMat);
          arm.position.set(Math.cos(angle) * 1, 0, Math.sin(angle) * 1);
          arm.lookAt(new THREE.Vector3(0, 0, 0));
          group.add(arm);
          
          const motorGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 8);
          const motor = new THREE.Mesh(motorGeo, new THREE.MeshLambertMaterial({ color: 0x222222 }));
          motor.position.set(Math.cos(angle) * 2, 0.2, Math.sin(angle) * 2);
          group.add(motor);
        }
        
        // Турели
        const turretGeo = new THREE.SphereGeometry(0.3, 8, 8);
        const turretMat = new THREE.MeshLambertMaterial({ color: 0x660000 });
        const turret1 = new THREE.Mesh(turretGeo, turretMat);
        turret1.position.set(1, -0.3, 0);
        group.add(turret1);
        const turret2 = new THREE.Mesh(turretGeo, turretMat);
        turret2.position.set(-1, -0.3, 0);
        group.add(turret2);
        
        hp = 500;
        detectionRange = 80;
        attackRange = 60;
        speed = 5;
        break;
      }
    }
    
    // Позиция — случайно на карте, но не рядом с базой игрока
    let x: number, z: number, y: number;
    do {
      x = randomRange(-150, 150);
      z = randomRange(-150, 150);
      y = this.world.getTerrainHeight(x, z);
    } while (distanceXZ(new THREE.Vector3(x, y, z), this.basePosition) < 40 || y < 0.5);
    
    if (type === 'drone' || type === 'boss') {
      y = randomRange(15, 30);
    }
    
    group.position.set(x, y + (type === 'drone' || type === 'boss' ? 0 : 0), z);
    this.scene.add(group);
    
    // Waypoints для патруля
    const waypoints: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      waypoints.push(new THREE.Vector3(
        x + randomRange(-20, 20),
        type === 'drone' || type === 'boss' ? randomRange(10, 30) : y,
        z + randomRange(-20, 20)
      ));
    }
    
    const enemy: Enemy = {
      type,
      mesh: group,
      position: group.position.clone(),
      hp,
      maxHP: hp,
      state: 'patrol',
      stateTimer: 0,
      targetPos: waypoints[0].clone(),
      waypoints,
      waypointIndex: 0,
      detectionRange,
      attackRange,
      attackCooldown: type === 'aagun' ? 0.3 : type === 'boss' ? 0.5 : 1.5,
      attackTimer: 0,
      speed,
      alive: true,
      deathTimer: 0,
    };
    
    if (type === 'boss') {
      enemy.phase = 1;
      enemy.phaseTimer = 0;
    }
    
    this.enemies.push(enemy);
    return enemy;
  }

  private updateEnemies(dt: number) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        enemy.deathTimer -= dt;
        if (enemy.deathTimer <= 0) {
          this.scene.remove(enemy.mesh);
        }
        continue;
      }
      
      const distToPlayer = enemy.position.distanceTo(this.drone.position);
      
      // FSM
      enemy.stateTimer += dt;
      enemy.attackTimer -= dt;
      
      // Обнаружение
      const stealthReduction = this.state.upgrades.stealth * 5;
      const effectiveRange = enemy.detectionRange - stealthReduction;
      
      if (distToPlayer < effectiveRange && enemy.state === 'patrol') {
        enemy.state = 'alert';
        enemy.stateTimer = 0;
      }
      
      switch (enemy.state) {
        case 'patrol': {
          // Движение к текущему waypoint
          const toWP = enemy.targetPos.clone().sub(enemy.position);
          toWP.y = 0;
          if (toWP.length() < 2) {
            enemy.waypointIndex = (enemy.waypointIndex + 1) % enemy.waypoints.length;
            enemy.targetPos.copy(enemy.waypoints[enemy.waypointIndex]);
          } else {
            toWP.normalize().multiplyScalar(enemy.speed * 0.5 * dt);
            enemy.position.add(toWP);
          }
          break;
        }
        
        case 'alert': {
          // Задержка перед атакой
          if (enemy.stateTimer > 0.8) {
            enemy.state = 'attack';
            enemy.stateTimer = 0;
          }
          // Поворот к игроку
          const lookDir = this.drone.position.clone().sub(enemy.position);
          enemy.mesh.lookAt(this.drone.position.x, enemy.position.y, this.drone.position.z);
          break;
        }
        
        case 'attack': {
          if (distToPlayer > effectiveRange * 1.5) {
            enemy.state = 'patrol';
            break;
          }
          
          // Поворот к игроку
          enemy.mesh.lookAt(this.drone.position.x, enemy.position.y, this.drone.position.z);
          
          // Атака
          if (enemy.attackTimer <= 0 && distToPlayer < enemy.attackRange) {
            this.enemyAttack(enemy);
            enemy.attackTimer = enemy.attackCooldown;
          }
          
          // Движение для летающих врагов
          if (enemy.type === 'drone' || enemy.type === 'boss') {
            const toPlayer = this.drone.position.clone().sub(enemy.position).normalize();
            
            if (enemy.type === 'drone' && distToPlayer < 5) {
              // Таран
              enemy.position.add(toPlayer.multiplyScalar(enemy.speed * dt));
            } else {
              // Преследование на дистанции
              const desiredDist = enemy.type === 'boss' ? 25 : 15;
              if (distToPlayer > desiredDist) {
                enemy.position.add(toPlayer.multiplyScalar(enemy.speed * dt));
              } else if (distToPlayer < desiredDist - 5) {
                enemy.position.add(toPlayer.multiplyScalar(-enemy.speed * 0.5 * dt));
              }
            }
          }
          
          // Босс — фазы
          if (enemy.type === 'boss' && enemy.phase) {
            enemy.phaseTimer! += dt;
            const hpPercent = enemy.hp / enemy.maxHP;
            if (hpPercent < 0.33 && enemy.phase < 3) {
              enemy.phase = 3;
              enemy.attackCooldown = 0.3;
              enemy.speed = 8;
            } else if (hpPercent < 0.66 && enemy.phase < 2) {
              enemy.phase = 2;
              enemy.attackCooldown = 0.4;
              enemy.speed = 6;
            }
          }
          break;
        }
        
        case 'retreat': {
          const awayFromPlayer = enemy.position.clone().sub(this.drone.position).normalize();
          enemy.position.add(awayFromPlayer.multiplyScalar(enemy.speed * dt));
          if (enemy.stateTimer > 3) {
            enemy.state = 'patrol';
          }
          break;
        }
      }
      
      // Обновляем позицию меша
      enemy.mesh.position.copy(enemy.position);
      
      // Летающие враги — покачивание
      if (enemy.type === 'drone' || enemy.type === 'boss') {
        enemy.mesh.position.y += Math.sin(this.gameTime * 3) * 0.02;
      }
    }
  }

  private enemyAttack(enemy: Enemy) {
    const dir = this.drone.position.clone().sub(enemy.position).normalize();
    
    switch (enemy.type) {
      case 'soldier': {
        // Пуля-трассер
        const bulletMesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xffff00 })
        );
        bulletMesh.position.copy(enemy.position).add(new THREE.Vector3(0, 1.5, 0));
        this.scene.add(bulletMesh);
        
        this.projectiles.push({
          mesh: bulletMesh,
          position: enemy.position.clone().add(new THREE.Vector3(0, 1.5, 0)),
          velocity: dir.multiplyScalar(50),
          damage: 10,
          lifetime: 2,
          type: 'tracer',
          owner: 'enemy',
        });
        audioManager.playShot();
        break;
      }
      
      case 'aagun': {
        // Очередь из 3 снарядов
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            if (!enemy.alive) return;
            const bulletMesh = new THREE.Mesh(
              new THREE.SphereGeometry(0.08, 4, 4),
              new THREE.MeshBasicMaterial({ color: 0xff8800 })
            );
            const startPos = enemy.position.clone().add(new THREE.Vector3(0, 1.3, 0));
            bulletMesh.position.copy(startPos);
            this.scene.add(bulletMesh);
            
            const spread = new THREE.Vector3(
              (Math.random() - 0.5) * 3,
              (Math.random() - 0.5) * 3,
              (Math.random() - 0.5) * 3
            );
            
            this.projectiles.push({
              mesh: bulletMesh,
              position: startPos,
              velocity: dir.clone().multiplyScalar(60).add(spread),
              damage: 25,
              lifetime: 3,
              type: 'tracer',
              owner: 'enemy',
            });
            audioManager.playShot();
          }, i * 100);
        }
        break;
      }
      
      case 'rocket': {
        // Самонаводящаяся ракета
        const rocketMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.05, 0.8, 6),
          new THREE.MeshLambertMaterial({ color: 0x888888 })
        );
        const startPos = enemy.position.clone().add(new THREE.Vector3(0, 1.5, 0));
        rocketMesh.position.copy(startPos);
        this.scene.add(rocketMesh);
        
        this.projectiles.push({
          mesh: rocketMesh,
          position: startPos,
          velocity: dir.clone().multiplyScalar(20),
          damage: 40,
          lifetime: 5,
          type: 'rocket',
          owner: 'enemy',
          target: this.drone.position.clone(),
        });
        audioManager.playRocketLaunch();
        break;
      }
      
      case 'drone': {
        // Таран — проверяем расстояние
        if (enemy.position.distanceTo(this.drone.position) < 3) {
          this.damageDrone(30);
          enemy.hp = 0;
          this.killEnemy(enemy);
          this.particles.emitExplosion(enemy.position.clone(), 1);
        }
        break;
      }
      
      case 'boss': {
        // Комбинированная атака
        if (Math.random() > 0.5) {
          // Ракета
          const rocketMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.08, 1, 6),
            new THREE.MeshLambertMaterial({ color: 0x660000 })
          );
          const startPos = enemy.position.clone();
          rocketMesh.position.copy(startPos);
          this.scene.add(rocketMesh);
          
          this.projectiles.push({
            mesh: rocketMesh,
            position: startPos,
            velocity: dir.clone().multiplyScalar(25),
            damage: 35,
            lifetime: 6,
            type: 'rocket',
            owner: 'enemy',
            target: this.drone.position.clone(),
          });
          audioManager.playRocketLaunch();
        } else {
          // Пулемёт
          for (let i = 0; i < 5; i++) {
            setTimeout(() => {
              if (!enemy.alive) return;
              const bulletMesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 4, 4),
                new THREE.MeshBasicMaterial({ color: 0xff4400 })
              );
              const startPos = enemy.position.clone().add(new THREE.Vector3(
                (Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2
              ));
              bulletMesh.position.copy(startPos);
              this.scene.add(bulletMesh);
              
              const spread = new THREE.Vector3(
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4,
                (Math.random() - 0.5) * 4
              );
              
              this.projectiles.push({
                mesh: bulletMesh,
                position: startPos,
                velocity: dir.clone().multiplyScalar(55).add(spread),
                damage: 15,
                lifetime: 2.5,
                type: 'tracer',
                owner: 'enemy',
              });
              audioManager.playShot();
            }, i * 80);
          }
        }
        break;
      }
    }
  }

  private killEnemy(enemy: Enemy) {
    enemy.alive = false;
    enemy.deathTimer = 2;
    enemy.mesh.visible = true;
    
    // Взрыв
    this.particles.emitExplosion(enemy.position.clone(), enemy.type === 'boss' ? 3 : 1);
    audioManager.playExplosion(enemy.type === 'boss' ? 2 : 1);
    audioManager.playEnemyDestroyed();
    
    // Очки
    const points = {
      soldier: 50,
      aagun: 200,
      rocket: 150,
      drone: 100,
      boss: 500,
    };
    this.state.score += points[enemy.type];
    this.state.kills++;
    this.state.coins += Math.floor(points[enemy.type] / 10);
    
    // Обновляем миссию
    this.updateMissionProgress('destroy', enemy.type);
    
    // Анимация смерти — падение
    const fallInterval = setInterval(() => {
      enemy.mesh.position.y -= 0.5;
      enemy.mesh.rotation.x += 0.1;
      if (enemy.mesh.position.y < 0) {
        clearInterval(fallInterval);
      }
    }, 50);
    
    this.notifyState();
  }

  // ===================== МИССИИ =====================
  
  startMission(index: number) {
    // Останавливаем любую текущую анимацию
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    this.state.currentMission = index;
    this.state.phase = 'playing';
    this.state.time = 0;
    this.state.kills = 0;
    this.state.shotsFired = 0;
    this.state.shotsHit = 0;
    this.state.bombs = 3 + this.state.upgrades.extraBombs;
    this.state.droneHP = this.state.droneMaxHP + this.state.upgrades.maxHP * 20;
    this.state.droneMaxHP = 100 + this.state.upgrades.maxHP * 20;
    this.state.battery = 100;
    
    // Цели миссии
    const mission = MISSIONS[index];
    this.state.missionObjectives = mission.objectives.map(o => ({
      ...o,
      completed: false,
      current: 0,
    }));
    
    // Ресет дрона
    this.resetToBase();
    
    // Спавн врагов
    this.spawnEnemies(index);
    
    // Скрываем чекпоинты если не первая миссия
    for (const cp of this.world.checkpoints) {
      cp.visible = index === 0;
    }
    
    this.running = true;
    this.notifyState();
    
    // Запускаем звуки
    audioManager.startMotorSound();
    audioManager.startWind();
  }

  private updateMissionProgress(type: string, target?: string) {
    for (const obj of this.state.missionObjectives) {
      if (obj.completed) continue;
      if (obj.type === type) {
        if (!obj.target || obj.target === target) {
          obj.current++;
          if (obj.current >= obj.required) {
            obj.completed = true;
          }
        }
      }
    }
    
    // Проверка чекпоинтов
    if (type === 'reach') {
      for (let i = 0; i < this.world.checkpoints.length; i++) {
        const cp = this.world.checkpoints[i];
        if (!cp.visible) continue;
        const dist = this.drone.position.distanceTo(cp.position);
        if (dist < 6) {
          cp.visible = false;
          this.updateMissionProgress('reach', `checkpoint${i}`);
          audioManager.playPickup();
        }
      }
      
      // Проверка возврата на базу
      if (distanceXZ(this.drone.position, this.basePosition) < 10) {
        this.updateMissionProgress('reach', 'base');
      }
      
      // Проверка вражеских баз (разведка)
      for (let i = 0; i < this.world.enemyBases.length; i++) {
        const base = this.world.enemyBases[i];
        const dist = this.drone.position.distanceTo(base.position);
        if (dist < 20) {
          this.updateMissionProgress('recon', `base${i}`);
        }
      }
    }
    
    // Проверка завершения миссии
    const allComplete = this.state.missionObjectives.every(o => o.completed);
    if (allComplete && this.state.missionObjectives.length > 0) {
      this.completeMission();
    }
    
    this.notifyState();
  }

  private checkMissionProgress() {
    // Проверка чекпоинтов
    for (let i = 0; i < this.world.checkpoints.length; i++) {
      const cp = this.world.checkpoints[i];
      if (!cp.visible) continue;
      const dist = this.drone.position.distanceTo(cp.position);
      if (dist < 6) {
        cp.visible = false;
        this.updateMissionProgress('reach', `checkpoint${i}`);
        audioManager.playPickup();
      }
    }
    
    // Проверка возврата на базу
    if (distanceXZ(this.drone.position, this.basePosition) < 10 && this.drone.position.y < 5) {
      this.updateMissionProgress('reach', 'base');
    }
    
    // Проверка разведки вражеских баз
    for (let i = 0; i < this.world.enemyBases.length; i++) {
      const base = this.world.enemyBases[i];
      const dist = this.drone.position.distanceTo(base.position);
      if (dist < 20) {
        this.updateMissionProgress('recon', `base${i}`);
      }
    }
  }

  private completeMission() {
    this.state.phase = 'victory';
    this.running = false;
    
    // Подсчёт звёзд
    const mission = MISSIONS[this.state.currentMission];
    const timeRatio = this.state.time / mission.timeLimit;
    let stars = 1;
    if (timeRatio < 0.5) stars = 3;
    else if (timeRatio < 0.75) stars = 2;
    
    // Бонус за точность
    if (this.state.shotsFired > 0) {
      this.state.accuracy = this.state.shotsHit / this.state.shotsFired;
    }
    
    this.state.stars = stars;
    this.state.coins += stars * 100;
    
    audioManager.stopMotorSound();
    audioManager.stopWind();
    
    // Сохранение
    this.saveProgress();
    this.notifyState();
  }

  // ===================== FPV ЭФФЕКТЫ =====================
  
  private updateFPVEffects() {
    if (this.cameraMode !== 'fpv') {
      this.fpvOverlay.visible = false;
      return;
    }
    this.fpvOverlay.visible = true;
    
    const ctx = this.fpvContext;
    const w = this.fpvCanvas.width;
    const h = this.fpvCanvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // Шум/статик
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    const noiseIntensity = 15;
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.random() * noiseIntensity;
      data[i] = noise;
      data[i + 1] = noise;
      data[i + 2] = noise;
      data[i + 3] = 30;
    }
    ctx.putImageData(imageData, 0, 0);
    
    // Scanlines
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    
    // Виньетка
    const gradient = ctx.createRadialGradient(w/2, h/2, w*0.3, w/2, h/2, w*0.7);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    
    this.fpvTexture.needsUpdate = true;
    
    // Позиционируем оверлей перед камерой
    this.fpvOverlay.position.copy(this.camera.position);
    this.fpvOverlay.quaternion.copy(this.camera.quaternion);
  }

  // ===================== ИГРОВОЙ ЦИКЛ =====================
  
  start() {
    this.running = true;
    this.clock.start();
    this.animate();
  }

  stop() {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    audioManager.stopMotorSound();
    audioManager.stopWind();
  }

  pause() {
    this.state.phase = 'paused';
    this.running = false;
    audioManager.stopMotorSound();
    audioManager.stopWind();
    this.notifyState();
  }

  resume() {
    this.state.phase = 'playing';
    this.running = true;
    audioManager.startMotorSound();
    audioManager.startWind();
    this.notifyState();
    this.animate();
  }

  private animate = () => {
    if (!this.running) return;
    
    this.animationId = requestAnimationFrame(this.animate);
    
    this.deltaTime = Math.min(this.clock.getDelta(), 0.05); // Cap dt
    this.gameTime += this.deltaTime;
    this.state.time += this.deltaTime;
    
    // Обновление систем
    this.updateDronePhysics(this.deltaTime);
    this.updateEnemies(this.deltaTime);
    this.updateProjectiles(this.deltaTime);
    this.particles.update(this.deltaTime);
    this.world.updateWater(this.gameTime);
    this.world.updateCheckpoints(this.gameTime);
    this.world.updatePickups(this.gameTime);
    
    // Обновление звуков
    audioManager.updateMotorSound(this.drone.throttle);
    audioManager.updateWind(this.drone.velocity.length());
    
    // Камера
    this.updateCamera();
    this.updateFPVEffects();
    
    // Проверка таймера миссии
    const mission = MISSIONS[this.state.currentMission];
    if (mission && this.state.time > mission.timeLimit) {
      this.state.phase = 'defeat';
      this.running = false;
      this.notifyState();
    }
    
    // Периодическая проверка целей миссии (разведка, чекпоинты)
    if (this.notifyCounter === 0) {
      this.checkMissionProgress();
    }
    
    // Рендер
    this.renderer.render(this.scene, this.camera);
    
    // Обновляем телеметрию дрона для HUD
    this.state.droneAlt = this.drone.position.y;
    this.state.droneSpeed = this.drone.velocity.length();
    this.state.droneThrottle = this.drone.throttle;
    
    // Уведомляем UI с троттлингом (каждые N кадров)
    this.notifyCounter++;
    if (this.notifyCounter >= this.NOTIFY_INTERVAL) {
      this.notifyCounter = 0;
      this.notifyState();
    }
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private notifyState() {
    if (this.onStateChange) {
      this.onStateChange({ ...this.state });
    }
  }

  // ===================== СОХРАНЕНИЕ =====================
  
  saveProgress() {
    const data = {
      score: this.state.score,
      coins: this.state.coins,
      currentMission: this.state.currentMission,
      upgrades: this.state.upgrades,
      stars: this.state.stars,
    };
    localStorage.setItem('fpvStrike_save', JSON.stringify(data));
  }

  loadProgress() {
    const raw = localStorage.getItem('fpvStrike_save');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        this.state.score = data.score || 0;
        this.state.coins = data.coins || 0;
        this.state.currentMission = data.currentMission || 0;
        this.state.upgrades = data.upgrades || this.state.upgrades;
        this.state.stars = data.stars || 0;
      } catch (e) { /* ignore */ }
    }
  }

  resetProgress() {
    localStorage.removeItem('fpvStrike_save');
    this.state.score = 0;
    this.state.coins = 0;
    this.state.currentMission = 0;
    this.state.upgrades = { maxHP: 0, batteryCapacity: 0, bombDamage: 0, repairSpeed: 0, stealth: 0, extraBombs: 0 };
    this.state.stars = 0;
  }

  updateSettings(settings: GameSettings) {
    this.settings = settings;
    audioManager.setMasterVolume(settings.masterVolume);
    audioManager.setSfxVolume(settings.sfxVolume);
    audioManager.setMusicVolume(settings.musicVolume);
  }

  // ===================== МЕНЮ-РЕНДЕР (для фона) =====================
  
  renderMenuBackground() {
    // Вращаем камеру вокруг сцены для фона меню
    this.camera.position.set(
      Math.cos(this.gameTime * 0.2) * 30,
      15,
      Math.sin(this.gameTime * 0.2) * 30
    );
    this.camera.lookAt(0, 5, 0);
    
    // Дрон летает по кругу
    this.drone.position.set(
      Math.cos(this.gameTime * 0.5) * 15,
      10 + Math.sin(this.gameTime) * 2,
      Math.sin(this.gameTime * 0.5) * 15
    );
    this.droneModel.group.position.copy(this.drone.position);
    this.droneModel.group.rotation.y = -this.gameTime * 0.5 + Math.PI;
    this.droneModel.updateRotors(this.gameTime, 0.6);
    
    this.renderer.render(this.scene, this.camera);
  }

  startMenuAnimation() {
    this.running = false; // Останавливаем игровой цикл если был
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    const menuAnimate = () => {
      if (this.state.phase !== 'menu') return;
      this.animationId = requestAnimationFrame(menuAnimate);
      this.gameTime += 0.016;
      this.world.updateWater(this.gameTime);
      this.world.updateCheckpoints(this.gameTime);
      this.renderMenuBackground();
    };
    menuAnimate();
  }

  dispose() {
    this.stop();
    this.renderer.dispose();
    audioManager.dispose();
  }
}

export { MISSIONS };
