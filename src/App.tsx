import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { audioManager } from './game/audio';

// ===================== ТИПЫ =====================

interface GameSettings {
  mouseSensX: number;
  mouseSensY: number;
  invertY: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  quality: 'low' | 'medium' | 'high';
  language: 'ru' | 'en';
}

interface DroneState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  throttle: number;
  hp: number;
  maxHp: number;
  battery: number;
  bombs: number;
  damaged: boolean;
}

interface Enemy {
  mesh: THREE.Group;
  position: THREE.Vector3;
  hp: number;
  maxHp: number;
  type: 'soldier' | 'aagun' | 'rocket' | 'drone' | 'boss';
  state: 'patrol' | 'attack' | 'dead';
  attackTimer: number;
  alive: boolean;
}

interface Projectile {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  damage: number;
  lifetime: number;
  type: 'bomb' | 'bullet' | 'rocket';
  owner: 'player' | 'enemy';
}

interface GameState {
  phase: 'menu' | 'playing' | 'paused' | 'victory' | 'defeat';
  currentMission: number;
  score: number;
  coins: number;
  time: number;
  droneAlt: number;
  droneSpeed: number;
  droneThrottle: number;
  cameraMode: string;
  warnings: string[];
  kills: number;
  objectives: { text: string; completed: boolean }[];
}

// ===================== УТИЛИТЫ =====================

const noise2D = (x: number, y: number): number => {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

const smoothNoise = (x: number, y: number): number => {
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
};

const fbm = (x: number, y: number, octaves: number): number => {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxValue;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const randomRange = (min: number, max: number) => min + Math.random() * (max - min);

const MISSIONS = [
  { name: 'Обучение', description: 'Пролетите через чекпоинты', enemies: [], timeLimit: 180 },
  { name: 'Разведка', description: 'Сфотографируйте 3 точки', enemies: ['soldier', 'soldier', 'soldier'], timeLimit: 240 },
  { name: 'Штурм', description: 'Уничтожьте вражескую базу', enemies: ['soldier', 'soldier', 'soldier', 'aagun'], timeLimit: 300 },
  { name: 'Оборона', description: 'Защитите свою базу', enemies: ['soldier', 'drone', 'rocket', 'drone'], timeLimit: 360 },
  { name: 'Босс', description: 'Уничтожьте супер-дрон', enemies: ['boss', 'soldier', 'aagun'], timeLimit: 420 },
];

// ===================== ГЛАВНЫЙ КОМПОНЕНТ =====================

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const droneRef = useRef<THREE.Group | null>(null);
  const droneStateRef = useRef<DroneState>({
    position: new THREE.Vector3(-50, 5, -50),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    throttle: 0,
    hp: 100,
    maxHp: 100,
    battery: 100,
    bombs: 3,
    damaged: false,
  });
  const enemiesRef = useRef<Enemy[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const mouseRef = useRef({ x: 0, y: 0, locked: false });
  const clockRef = useRef(new THREE.Clock());
  const animFrameRef = useRef<number | null>(null);
  const gameTimeRef = useRef(0);
  const cameraModeRef = useRef<'fpv' | 'chase' | 'orbit'>('fpv');
  const phaseRef = useRef<string>('menu');

  const [gameState, setGameState] = useState<GameState>({
    phase: 'menu',
    currentMission: 0,
    score: 0,
    coins: 0,
    time: 0,
    droneAlt: 0,
    droneSpeed: 0,
    droneThrottle: 0,
    cameraMode: 'fpv',
    warnings: [],
    kills: 0,
    objectives: [],
  });

  // Синхронизируем ref с состоянием
  useEffect(() => {
    phaseRef.current = gameState.phase;
  }, [gameState.phase]);

  const [settings, setSettings] = useState<GameSettings>({
    mouseSensX: 5,
    mouseSensY: 5,
    invertY: false,
    masterVolume: 0.7,
    sfxVolume: 0.8,
    musicVolume: 0.3,
    quality: 'medium',
    language: 'ru',
  });

  const [showSettings, setShowSettings] = useState(false);
  const [screen, setScreen] = useState<'menu' | 'missions' | 'records' | 'about'>('menu');

  // ===================== ИНИЦИАЛИЗАЦИЯ THREE.JS =====================

  useEffect(() => {
    if (!containerRef.current) return;

    // Сцена
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.005);
    sceneRef.current = scene;

    // Камера
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 10, 20);
    cameraRef.current = camera;

    // Рендерер
    const renderer = new THREE.WebGLRenderer({ antialias: settings.quality !== 'low' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = settings.quality !== 'low';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Освещение
    const ambient = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(100, 80, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 300;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    scene.add(sun);

    // Небо
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
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Рельеф
    const terrainGeo = new THREE.PlaneGeometry(400, 400, 100, 100);
    terrainGeo.rotateX(-Math.PI / 2);
    const positions = terrainGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const distFromCenter = Math.sqrt(x * x + z * z) / 200;
      const islandMask = Math.max(0, 1 - distFromCenter * distFromCenter);
      const height = fbm(x * 0.01, z * 0.01, 4) * 15 * islandMask;
      const distFromBase = Math.sqrt((x + 50) * (x + 50) + (z + 50) * (z + 50));
      const baseFlatten = distFromBase < 30 ? Math.max(0, 1 - distFromBase / 30) : 0;
      positions.setY(i, height * (1 - baseFlatten * 0.8));
    }
    terrainGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ color: 0x3d8c40 }));
    terrain.receiveShadow = true;
    scene.add(terrain);

    // Вода
    const waterGeo = new THREE.PlaneGeometry(800, 800, 50, 50);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
      color: 0x006994,
      transparent: true,
      opacity: 0.7,
      shininess: 100,
    }));
    water.position.y = -1;
    scene.add(water);

    // Деревья
    const treeCount = 80;
    for (let i = 0; i < treeCount; i++) {
      const x = randomRange(-150, 150);
      const z = randomRange(-150, 150);
      const distFromBase = Math.sqrt((x + 50) * (x + 50) + (z + 50) * (z + 50));
      if (distFromBase < 25) continue;
      const distFromCenter = Math.sqrt(x * x + z * z) / 200;
      const islandMask = Math.max(0, 1 - distFromCenter * distFromCenter);
      const y = fbm(x * 0.01, z * 0.01, 4) * 15 * islandMask;
      if (y < 0.5) continue;
      const scale = randomRange(0.7, 1.3);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.5, 4 * scale, 6),
        new THREE.MeshLambertMaterial({ color: 0x4a2f1a })
      );
      trunk.position.set(x, y + 2 * scale, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(2.5 * scale, 6 * scale, 6),
        new THREE.MeshLambertMaterial({ color: 0x2d6b30 })
      );
      crown.position.set(x, y + 5.5 * scale, z);
      crown.castShadow = true;
      scene.add(crown);
    }

    // База игрока
    const baseGroup = new THREE.Group();
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 0.3, 32),
      new THREE.MeshLambertMaterial({ color: 0x444444 })
    );
    pad.receiveShadow = true;
    baseGroup.add(pad);
    const line1 = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.05, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    line1.position.y = 0.35;
    baseGroup.add(line1);
    const line2 = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.05, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    line2.position.y = 0.35;
    line2.rotation.y = Math.PI / 2;
    baseGroup.add(line2);
    const hangar = new THREE.Mesh(
      new THREE.BoxGeometry(12, 6, 15),
      new THREE.MeshLambertMaterial({ color: 0x556B2F })
    );
    hangar.position.set(-15, 3, 0);
    hangar.castShadow = true;
    baseGroup.add(hangar);
    baseGroup.position.set(-50, 0, -50);
    scene.add(baseGroup);

    // Дрон
    const drone = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.2, 0.8),
      new THREE.MeshLambertMaterial({ color: 0x222222 })
    );
    body.castShadow = true;
    drone.add(body);
    const arm1 = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.08, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    arm1.rotation.y = Math.PI / 4;
    drone.add(arm1);
    const arm2 = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.08, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    arm2.rotation.y = -Math.PI / 4;
    drone.add(arm2);
    const motorPositions = [
      { x: 0.5, z: 0.5 }, { x: -0.5, z: 0.5 },
      { x: 0.5, z: -0.5 }, { x: -0.5, z: -0.5 },
    ];
    for (const pos of motorPositions) {
      const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.15, 8),
        new THREE.MeshLambertMaterial({ color: 0x444444 })
      );
      motor.position.set(pos.x, 0.1, pos.z);
      drone.add(motor);
      const prop = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.02, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.7 })
      );
      prop.position.set(pos.x, 0.2, pos.z);
      prop.userData.isProp = true;
      drone.add(prop);
    }
    const cam = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00aaff })
    );
    cam.position.set(0, -0.05, 0.45);
    drone.add(cam);
    drone.position.copy(droneStateRef.current.position);
    scene.add(drone);
    droneRef.current = drone;

    // Обработчики
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
      if (e.code === 'Escape') {
        setGameState(prev => {
          if (prev.phase === 'playing') return { ...prev, phase: 'paused' };
          if (prev.phase === 'paused') return { ...prev, phase: 'playing' };
          return prev;
        });
      }
      if (e.code === 'KeyC') {
        const modes: Array<'fpv' | 'chase' | 'orbit'> = ['fpv', 'chase', 'orbit'];
        const idx = modes.indexOf(cameraModeRef.current);
        cameraModeRef.current = modes[(idx + 1) % modes.length];
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.code] = false; };
    const handleMouseMove = (e: MouseEvent) => {
      if (mouseRef.current.locked) {
        mouseRef.current.x += e.movementX * settings.mouseSensX * 0.001;
        mouseRef.current.y += e.movementY * settings.mouseSensY * 0.001;
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (gameState.phase === 'playing') {
        if (e.button === 0) dropBomb();
      }
    };
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };
    const handleClick = () => {
      if (gameState.phase === 'playing' && rendererRef.current && !mouseRef.current.locked) {
        rendererRef.current.domElement.requestPointerLock();
      }
    };
    const handlePointerLockChange = () => {
      mouseRef.current.locked = document.pointerLockElement === rendererRef.current?.domElement;
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    window.addEventListener('resize', handleResize);

    // Меню анимация
    const menuAnimate = () => {
      if (phaseRef.current !== 'menu') return;
      animFrameRef.current = requestAnimationFrame(menuAnimate);
      gameTimeRef.current += 0.016;
      if (cameraRef.current) {
        cameraRef.current.position.set(
          Math.cos(gameTimeRef.current * 0.2) * 30,
          15,
          Math.sin(gameTimeRef.current * 0.2) * 30
        );
        cameraRef.current.lookAt(0, 5, 0);
      }
      if (droneRef.current) {
        droneRef.current.position.set(
          Math.cos(gameTimeRef.current * 0.5) * 15,
          10 + Math.sin(gameTimeRef.current) * 2,
          Math.sin(gameTimeRef.current * 0.5) * 15
        );
        droneRef.current.rotation.y = -gameTimeRef.current * 0.5 + Math.PI;
        droneRef.current.children.forEach(child => {
          if (child.userData.isProp) {
            child.rotation.y += 0.5;
          }
        });
      }
      renderer.render(scene, camera);
    };
    menuAnimate();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // ===================== ИГРОВОЙ ЦИКЛ =====================

  const startGame = useCallback((missionIndex: number) => {
    if (!sceneRef.current || !cameraRef.current || !rendererRef.current || !droneRef.current) return;

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const drone = droneRef.current;

    // Сброс дрона
    droneStateRef.current = {
      position: new THREE.Vector3(-50, 5, -50),
      velocity: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      throttle: 0,
      hp: 100,
      maxHp: 100,
      battery: 100,
      bombs: 3,
      damaged: false,
    };
    drone.position.copy(droneStateRef.current.position);
    drone.quaternion.copy(droneStateRef.current.quaternion);

    // Спавн врагов
    enemiesRef.current.forEach(e => scene.remove(e.mesh));
    enemiesRef.current = [];
    const mission = MISSIONS[missionIndex];
    for (const type of mission.enemies) {
      const enemy = createEnemy(type as Enemy['type'], scene);
      enemiesRef.current.push(enemy);
    }

    // Цели миссии
    const objectives = [
      { text: 'Уничтожить всех врагов', completed: false },
    ];

    setGameState({
      phase: 'playing',
      currentMission: missionIndex,
      score: 0,
      coins: 0,
      time: 0,
      droneAlt: 5,
      droneSpeed: 0,
      droneThrottle: 0,
      cameraMode: 'fpv',
      warnings: [],
      kills: 0,
      objectives,
    });

    audioManager.init();
    audioManager.resume();
    audioManager.startMotorSound();

    clockRef.current.start();
    gameTimeRef.current = 0;

    const gameLoop = () => {
      if (phaseRef.current !== 'playing') return;
      animFrameRef.current = requestAnimationFrame(gameLoop);

      const dt = Math.min(clockRef.current.getDelta(), 0.05);
      gameTimeRef.current += dt;

      // Обновление дрона
      updateDrone(dt);

      // Обновление врагов
      updateEnemies(dt);

      // Обновление снарядов
      updateProjectiles(dt);

      // Камера
      updateCamera();

      // Обновление HUD
      setGameState(prev => ({
        ...prev,
        time: gameTimeRef.current,
        droneAlt: droneStateRef.current.position.y,
        droneSpeed: droneStateRef.current.velocity.length(),
        droneThrottle: droneStateRef.current.throttle,
        cameraMode: cameraModeRef.current,
        warnings: droneStateRef.current.battery < 20 ? ['НИЗКАЯ БАТАРЕЯ'] : [],
      }));

      renderer.render(scene, camera);
    };

    gameLoop();
  }, [gameState.phase]);

  const updateDrone = (dt: number) => {
    const d = droneStateRef.current;
    const drone = droneRef.current;
    if (!drone) return;

    // Управление
    if (keysRef.current['KeyW']) d.throttle = Math.min(1, d.throttle + dt * 1.5);
    if (keysRef.current['KeyS']) d.throttle = Math.max(0, d.throttle - dt * 1.5);
    if (keysRef.current['Space']) d.throttle = Math.min(1, d.throttle + dt * 2);
    if (keysRef.current['ShiftLeft']) d.throttle = Math.max(0, d.throttle - dt * 2);

    // Поворот
    const yaw = new THREE.Quaternion();
    yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -mouseRef.current.x * 0.5);
    d.quaternion.multiply(yaw);
    mouseRef.current.x *= 0.9;

    const pitch = new THREE.Quaternion();
    pitch.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -mouseRef.current.y * 0.3);
    d.quaternion.multiply(pitch);
    mouseRef.current.y *= 0.85;

    if (keysRef.current['KeyA']) {
      const roll = new THREE.Quaternion();
      roll.setFromAxisAngle(new THREE.Vector3(0, 0, 1), dt * 2);
      d.quaternion.multiply(roll);
    }
    if (keysRef.current['KeyD']) {
      const roll = new THREE.Quaternion();
      roll.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -dt * 2);
      d.quaternion.multiply(roll);
    }

    d.quaternion.normalize();

    // Тяга
    const thrust = d.throttle * 25;
    const thrustDir = new THREE.Vector3(0, 1, 0).applyQuaternion(d.quaternion);
    const thrustForce = thrustDir.multiplyScalar(thrust);

    // Гравитация
    const gravity = new THREE.Vector3(0, -9.81, 0);

    // Сопротивление
    const drag = d.velocity.clone().multiplyScalar(-0.3);

    // Интеграция
    const totalForce = new THREE.Vector3();
    totalForce.add(thrustForce);
    totalForce.add(gravity);
    totalForce.add(drag);
    const acceleration = totalForce.divideScalar(1.5);
    d.velocity.add(acceleration.multiplyScalar(dt));
    d.position.add(d.velocity.clone().multiplyScalar(dt));

    // Земля
    if (d.position.y < 0.5) {
      d.position.y = 0.5;
      d.velocity.y = Math.max(0, d.velocity.y);
    }

    // Батарея
    d.battery = Math.max(0, d.battery - d.throttle * 3 * dt);

    // Обновление модели
    drone.position.copy(d.position);
    drone.quaternion.copy(d.quaternion);
    drone.children.forEach(child => {
      if (child.userData.isProp) {
        child.rotation.y += d.throttle * 2;
      }
    });

    // Зарядка на базе
    const distToBase = Math.sqrt(
      Math.pow(d.position.x + 50, 2) + Math.pow(d.position.z + 50, 2)
    );
    if (distToBase < 10 && d.position.y < 4) {
      d.battery = Math.min(100, d.battery + dt * 20);
      d.hp = Math.min(d.maxHp, d.hp + dt * 10);
    }

    // Проверка смерти
    if (d.hp <= 0 || d.battery <= 0) {
      setGameState(prev => ({ ...prev, phase: 'defeat' }));
      audioManager.stopMotorSound();
    }

    audioManager.updateMotorSound(d.throttle);
  };

  const createEnemy = (type: Enemy['type'], scene: THREE.Scene): Enemy => {
    const group = new THREE.Group();
    let hp = 30;

    switch (type) {
      case 'soldier': {
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 1.5, 8),
          new THREE.MeshLambertMaterial({ color: 0x556B2F })
        );
        body.position.y = 1;
        group.add(body);
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.25, 8, 8),
          new THREE.MeshLambertMaterial({ color: 0xDEB887 })
        );
        head.position.y = 2;
        group.add(head);
        hp = 30;
        break;
      }
      case 'aagun': {
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(1.5, 2, 1, 8),
          new THREE.MeshLambertMaterial({ color: 0x4a5d23 })
        );
        base.position.y = 0.5;
        group.add(base);
        const turret = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 0.6, 1.5),
          new THREE.MeshLambertMaterial({ color: 0x556B2F })
        );
        turret.position.y = 1.3;
        group.add(turret);
        hp = 100;
        break;
      }
      case 'rocket': {
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8),
          new THREE.MeshLambertMaterial({ color: 0x8B0000 })
        );
        body.position.y = 1;
        group.add(body);
        hp = 50;
        break;
      }
      case 'drone': {
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.15, 0.6),
          new THREE.MeshLambertMaterial({ color: 0x8B0000 })
        );
        group.add(body);
        hp = 40;
        break;
      }
      case 'boss': {
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(1.5, 1.5, 0.5, 6),
          new THREE.MeshLambertMaterial({ color: 0x4a0000 })
        );
        group.add(body);
        hp = 500;
        break;
      }
    }

    const x = randomRange(-150, 150);
    const z = randomRange(-150, 150);
    const y = type === 'drone' || type === 'boss' ? randomRange(15, 30) : 0;
    group.position.set(x, y, z);
    scene.add(group);

    return {
      mesh: group,
      position: group.position.clone(),
      hp,
      maxHp: hp,
      type,
      state: 'patrol',
      attackTimer: 0,
      alive: true,
    };
  };

  const updateEnemies = (dt: number) => {
    const drone = droneStateRef.current;
    for (const enemy of enemiesRef.current) {
      if (!enemy.alive) continue;

      const dist = enemy.position.distanceTo(drone.position);

      // AI
      if (dist < 50 && enemy.state === 'patrol') {
        enemy.state = 'attack';
      }

      if (enemy.state === 'attack') {
        // Движение к игроку
        if (enemy.type === 'drone' || enemy.type === 'boss') {
          const dir = drone.position.clone().sub(enemy.position).normalize();
          enemy.position.add(dir.multiplyScalar(dt * 5));
        }

        // Атака
        enemy.attackTimer -= dt;
        if (enemy.attackTimer <= 0 && dist < 40) {
          shootAtPlayer(enemy);
          enemy.attackTimer = enemy.type === 'aagun' ? 0.3 : 1.5;
        }
      }

      enemy.mesh.position.copy(enemy.position);
    }
  };

  const shootAtPlayer = (enemy: Enemy) => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const drone = droneStateRef.current;

    const bullet = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    bullet.position.copy(enemy.position);
    scene.add(bullet);

    const dir = drone.position.clone().sub(enemy.position).normalize();
    projectilesRef.current.push({
      mesh: bullet,
      position: enemy.position.clone(),
      velocity: dir.multiplyScalar(30),
      damage: 10,
      lifetime: 3,
      type: 'bullet',
      owner: 'enemy',
    });

    audioManager.playShot();
  };

  const updateProjectiles = (dt: number) => {
    const drone = droneStateRef.current;
    for (let i = projectilesRef.current.length - 1; i >= 0; i--) {
      const p = projectilesRef.current[i];
      p.lifetime -= dt;

      if (p.lifetime <= 0) {
        sceneRef.current?.remove(p.mesh);
        projectilesRef.current.splice(i, 1);
        continue;
      }

      if (p.type === 'bomb') {
        p.velocity.y -= 9.81 * dt;
      }

      p.position.add(p.velocity.clone().multiplyScalar(dt));
      p.mesh.position.copy(p.position);

      // Коллизия с землёй
      if (p.position.y < 0) {
        if (p.type === 'bomb') {
          explodeBomb(p);
        }
        sceneRef.current?.remove(p.mesh);
        projectilesRef.current.splice(i, 1);
        continue;
      }

      // Коллизия с врагами
      if (p.owner === 'player') {
        for (const enemy of enemiesRef.current) {
          if (!enemy.alive) continue;
          const dist = p.position.distanceTo(enemy.position);
          if (dist < 3) {
            enemy.hp -= p.damage;
            if (enemy.hp <= 0) {
              killEnemy(enemy);
            }
            sceneRef.current?.remove(p.mesh);
            projectilesRef.current.splice(i, 1);
            break;
          }
        }
      }

      // Коллизия с дроном
      if (p.owner === 'enemy') {
        const dist = p.position.distanceTo(drone.position);
        if (dist < 2) {
          drone.hp -= p.damage;
          drone.damaged = drone.hp < 50;
          audioManager.playHit();
          sceneRef.current?.remove(p.mesh);
          projectilesRef.current.splice(i, 1);
        }
      }
    }
  };

  const explodeBomb = (p: Projectile) => {
    const drone = droneStateRef.current;
    audioManager.playExplosion(1.5);

    for (const enemy of enemiesRef.current) {
      if (!enemy.alive) continue;
      const dist = enemy.position.distanceTo(p.position);
      if (dist < 8) {
        enemy.hp -= p.damage * (1 - dist / 8);
        if (enemy.hp <= 0) {
          killEnemy(enemy);
        }
      }
    }
  };

  const killEnemy = (enemy: Enemy) => {
    enemy.alive = false;
    audioManager.playExplosion(1);
    audioManager.playEnemyDestroyed();

    const points = { soldier: 50, aagun: 200, rocket: 150, drone: 100, boss: 500 };
    setGameState(prev => ({
      ...prev,
      score: prev.score + points[enemy.type],
      kills: prev.kills + 1,
      coins: prev.coins + Math.floor(points[enemy.type] / 10),
    }));

    // Анимация падения
    let fallCount = 0;
    const fallInterval = setInterval(() => {
      enemy.mesh.position.y -= 0.5;
      enemy.mesh.rotation.x += 0.1;
      fallCount++;
      if (fallCount > 20) {
        clearInterval(fallInterval);
        sceneRef.current?.remove(enemy.mesh);
      }
    }, 50);

    // Проверка победы
    setTimeout(() => {
      const allDead = enemiesRef.current.every(e => !e.alive);
      if (allDead) {
        setGameState(prev => ({ ...prev, phase: 'victory' }));
        audioManager.stopMotorSound();
      }
    }, 1000);
  };

  const dropBomb = () => {
    if (!sceneRef.current || droneStateRef.current.bombs <= 0) return;
    const drone = droneStateRef.current;
    drone.bombs--;

    const bomb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.1, 0.6, 8),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    bomb.position.copy(drone.position);
    sceneRef.current.add(bomb);

    projectilesRef.current.push({
      mesh: bomb,
      position: drone.position.clone(),
      velocity: drone.velocity.clone().add(new THREE.Vector3(0, -2, 0)),
      damage: 50,
      lifetime: 10,
      type: 'bomb',
      owner: 'player',
    });

    audioManager.playShot();
  };

  const updateCamera = () => {
    if (!cameraRef.current || !droneRef.current) return;
    const camera = cameraRef.current;
    const drone = droneRef.current;
    const dronePos = droneStateRef.current.position;

    switch (cameraModeRef.current) {
      case 'fpv': {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(droneStateRef.current.quaternion);
        camera.position.copy(dronePos).add(forward.clone().multiplyScalar(0.3));
        const lookTarget = dronePos.clone().add(forward.clone().multiplyScalar(10));
        camera.lookAt(lookTarget);
        camera.rotateY(-mouseRef.current.x * 0.3);
        camera.rotateX(-mouseRef.current.y * 0.3);
        break;
      }
      case 'chase': {
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(droneStateRef.current.quaternion);
        const targetPos = dronePos.clone().add(back.multiplyScalar(8)).add(new THREE.Vector3(0, 3, 0));
        camera.position.lerp(targetPos, 0.05);
        camera.lookAt(dronePos);
        break;
      }
      case 'orbit': {
        const orbitPos = new THREE.Vector3(
          dronePos.x + Math.cos(gameTimeRef.current * 0.3) * 12,
          dronePos.y + 5,
          dronePos.z + Math.sin(gameTimeRef.current * 0.3) * 12
        );
        camera.position.lerp(orbitPos, 0.05);
        camera.lookAt(dronePos);
        break;
      }
    }
  };

  // ===================== UI HANDLERS =====================

  const handlePlay = () => {
    audioManager.init();
    audioManager.resume();
    audioManager.playClick();
    setScreen('missions');
  };

  const handleStartMission = (idx: number) => {
    audioManager.playClick();
    startGame(idx);
  };

  const handleBack = () => {
    audioManager.playClick();
    setScreen('menu');
    setGameState(prev => ({ ...prev, phase: 'menu' }));
  };

  const handleResume = () => {
    audioManager.playClick();
    setGameState(prev => ({ ...prev, phase: 'playing' }));
  };

  const handleRestart = () => {
    audioManager.playClick();
    startGame(gameState.currentMission);
  };

  const handleQuit = () => {
    audioManager.playClick();
    setGameState(prev => ({ ...prev, phase: 'menu' }));
    setScreen('menu');
    audioManager.stopMotorSound();
  };

  // ===================== RENDER =====================

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="game-canvas" />

      {/* Главное меню */}
      {gameState.phase === 'menu' && screen === 'menu' && (
        <div className="menu-overlay flex flex-col items-center justify-center gap-6">
          <div className="text-center mb-8">
            <h1 className="text-6xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-orange-400">
              FPV STRIKE
            </h1>
            <p className="text-cyan-300/70 text-lg mt-2">БОЕВОЙ FPV-ДРОН</p>
          </div>
          <div className="flex flex-col gap-3 w-64">
            <button onClick={handlePlay} className="btn-game-primary">▶ Играть</button>
            <button onClick={() => { audioManager.playClick(); setScreen('records'); }} className="btn-game">🏆 Рекорды</button>
            <button onClick={() => { audioManager.playClick(); setShowSettings(true); }} className="btn-game">⚙ Настройки</button>
            <button onClick={() => { audioManager.playClick(); setScreen('about'); }} className="btn-game">ℹ Об игре</button>
          </div>
        </div>
      )}

      {/* Выбор миссии */}
      {gameState.phase === 'menu' && screen === 'missions' && (
        <div className="menu-overlay flex flex-col items-center justify-center gap-4">
          <h2 className="text-3xl font-bold text-cyan-400">ВЫБОР МИССИИ</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl w-full px-4">
            {MISSIONS.map((mission, idx) => (
              <button
                key={idx}
                onClick={() => handleStartMission(idx)}
                className="p-4 rounded-lg border border-cyan-400/50 bg-gray-800/80 hover:bg-gray-700/80 text-left"
              >
                <h3 className="text-lg font-bold text-white">{idx + 1}. {mission.name}</h3>
                <p className="text-gray-400 text-sm mt-1">{mission.description}</p>
                <p className="text-gray-500 text-xs mt-2">
                  ⏱ {Math.floor(mission.timeLimit / 60)}:{(mission.timeLimit % 60).toString().padStart(2, '0')} | 👾 {mission.enemies.length}
                </p>
              </button>
            ))}
          </div>
          <button onClick={handleBack} className="btn-game mt-4">← Назад</button>
        </div>
      )}

      {/* HUD */}
      {gameState.phase === 'playing' && (
        <div className="hud-overlay">
          <div className="absolute top-4 left-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-red-400 text-sm font-bold w-8">HP</span>
              <div className="w-32 h-3 bg-gray-800 rounded overflow-hidden border border-gray-600">
                <div className="h-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${(droneStateRef.current.hp / droneStateRef.current.maxHp) * 100}%` }} />
              </div>
              <span className="text-red-300 text-xs font-mono">{Math.round(droneStateRef.current.hp)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-yellow-400 text-sm font-bold w-8">⚡</span>
              <div className="w-32 h-3 bg-gray-800 rounded overflow-hidden border border-gray-600">
                <div className={`h-full ${droneStateRef.current.battery < 20 ? 'bg-red-500 warning-flash' : 'bg-gradient-to-r from-yellow-600 to-green-400'}`} style={{ width: `${droneStateRef.current.battery}%` }} />
              </div>
              <span className="text-yellow-300 text-xs font-mono">{Math.round(droneStateRef.current.battery)}%</span>
            </div>
          </div>
          <div className="absolute top-4 right-4 text-right space-y-1">
            <div className="text-yellow-400 font-mono text-sm">🏆 {gameState.score}</div>
            <div className="text-cyan-400 font-mono text-sm">Миссия {gameState.currentMission + 1}</div>
            <div className="text-white font-mono text-lg">⏱ {Math.floor(gameState.time / 60)}:{Math.floor(gameState.time % 60).toString().padStart(2, '0')}</div>
          </div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="relative w-8 h-8">
              <div className="absolute top-0 left-1/2 w-0.5 h-2 bg-cyan-400/70 -translate-x-1/2" />
              <div className="absolute bottom-0 left-1/2 w-0.5 h-2 bg-cyan-400/70 -translate-x-1/2" />
              <div className="absolute left-0 top-1/2 w-2 h-0.5 bg-cyan-400/70 -translate-y-1/2" />
              <div className="absolute right-0 top-1/2 w-2 h-0.5 bg-cyan-400/70 -translate-y-1/2" />
            </div>
          </div>
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
            <div className="bg-black/50 rounded px-4 py-2 border border-cyan-400/20">
              <div className="flex gap-6 text-xs font-mono">
                <div className="text-green-400">ALT <span className="text-white">{gameState.droneAlt.toFixed(1)}</span>m</div>
                <div className="text-blue-400">SPD <span className="text-white">{gameState.droneSpeed.toFixed(1)}</span>м/с</div>
                <div className="text-gray-400">CAM: <span className="text-cyan-400 uppercase">{gameState.cameraMode}</span></div>
              </div>
            </div>
          </div>
          {gameState.warnings.length > 0 && (
            <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2">
              {gameState.warnings.map((w, i) => (
                <div key={i} className="text-red-400 text-lg font-bold warning-flash text-center">⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Пауза */}
      {gameState.phase === 'paused' && (
        <div className="menu-overlay">
          <div className="bg-gray-900/95 border border-cyan-400/30 rounded-lg p-8 text-center">
            <h2 className="text-3xl font-bold text-cyan-400 mb-6">⏸ ПАУЗА</h2>
            <div className="flex flex-col gap-3 w-56 mx-auto">
              <button onClick={handleResume} className="btn-game-primary">▶ Продолжить</button>
              <button onClick={handleRestart} className="btn-game">🔄 Рестарт</button>
              <button onClick={handleQuit} className="btn-game">🚪 Выйти</button>
            </div>
          </div>
        </div>
      )}

      {/* Победа */}
      {gameState.phase === 'victory' && (
        <div className="menu-overlay">
          <div className="bg-gray-900/95 border border-green-400/30 rounded-lg p-8 text-center max-w-md">
            <h2 className="text-4xl font-bold text-green-400 mb-2">🎉 ПОБЕДА!</h2>
            <div className="bg-gray-800/50 rounded-lg p-4 mb-6 text-left space-y-2">
              <div className="flex justify-between text-gray-300">
                <span>⏱ Время:</span>
                <span>{Math.floor(gameState.time / 60)}:{Math.floor(gameState.time % 60).toString().padStart(2, '0')}</span>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>💀 Убийства:</span>
                <span>{gameState.kills}</span>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>🏆 Очки:</span>
                <span className="text-yellow-400">{gameState.score}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={handleRestart} className="btn-game">🔄 Повторить</button>
              <button onClick={handleQuit} className="btn-game">🏠 В меню</button>
            </div>
          </div>
        </div>
      )}

      {/* Поражение */}
      {gameState.phase === 'defeat' && (
        <div className="menu-overlay">
          <div className="bg-gray-900/95 border border-red-400/30 rounded-lg p-8 text-center max-w-md">
            <h2 className="text-4xl font-bold text-red-400 mb-2">💥 ПРОВАЛ</h2>
            <div className="flex flex-col gap-2 mt-6">
              <button onClick={handleRestart} className="btn-game-primary">🔄 Попробовать снова</button>
              <button onClick={handleQuit} className="btn-game">🏠 В меню</button>
            </div>
          </div>
        </div>
      )}

      {/* Рекорды */}
      {gameState.phase === 'menu' && screen === 'records' && (
        <div className="menu-overlay flex flex-col items-center justify-center gap-4">
          <h2 className="text-3xl font-bold text-yellow-400">🏆 РЕКОРДЫ</h2>
          <div className="bg-gray-800/80 border border-gray-600/50 rounded-lg p-6 max-w-md w-full">
            <div className="text-center">
              <p className="text-gray-400">Лучший счёт</p>
              <p className="text-4xl font-bold text-yellow-400">{gameState.score}</p>
            </div>
          </div>
          <button onClick={handleBack} className="btn-game">← Назад</button>
        </div>
      )}

      {/* Об игре */}
      {gameState.phase === 'menu' && screen === 'about' && (
        <div className="menu-overlay flex flex-col items-center justify-center gap-4">
          <div className="bg-gray-900/95 border border-cyan-400/30 rounded-lg p-8 max-w-lg text-center">
            <h2 className="text-3xl font-bold text-cyan-400 mb-4">ℹ ОБ ИГРЕ</h2>
            <div className="text-gray-300 space-y-3 text-left">
              <p><strong className="text-white">FPV STRIKE</strong> — аркадный симулятор боевого FPV-дрона.</p>
              <div className="bg-gray-800/50 rounded p-3 mt-4">
                <h3 className="text-cyan-400 font-bold mb-2">Управление:</h3>
                <ul className="text-sm space-y-1 text-gray-400">
                  <li><kbd className="text-white">W/S</kbd> — тяга</li>
                  <li><kbd className="text-white">A/D</kbd> — крен</li>
                  <li><kbd className="text-white">Мышь</kbd> — камера</li>
                  <li><kbd className="text-white">ЛКМ</kbd> — бомба</li>
                  <li><kbd className="text-white">C</kbd> — камера</li>
                  <li><kbd className="text-white">ESC</kbd> — пауза</li>
                </ul>
              </div>
            </div>
          </div>
          <button onClick={handleBack} className="btn-game">← Назад</button>
        </div>
      )}

      {/* Настройки */}
      {showSettings && (
        <div className="menu-overlay" onClick={() => setShowSettings(false)}>
          <div className="bg-gray-900/95 border border-cyan-400/30 rounded-lg p-8 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-2xl font-bold text-cyan-400 mb-6">⚙ Настройки</h2>
            <div className="space-y-5">
              <div>
                <label className="text-gray-300 text-sm">Чувствительность мыши X: {settings.mouseSensX.toFixed(1)}</label>
                <input type="range" min="1" max="20" step="0.5" value={settings.mouseSensX}
                  onChange={e => setSettings({ ...settings, mouseSensX: parseFloat(e.target.value) })}
                  className="slider-game mt-1" />
              </div>
              <div>
                <label className="text-gray-300 text-sm">Чувствительность мыши Y: {settings.mouseSensY.toFixed(1)}</label>
                <input type="range" min="1" max="20" step="0.5" value={settings.mouseSensY}
                  onChange={e => setSettings({ ...settings, mouseSensY: parseFloat(e.target.value) })}
                  className="slider-game mt-1" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300 text-sm">Инверсия оси Y</span>
                <button onClick={() => setSettings({ ...settings, invertY: !settings.invertY })}
                  className={`w-12 h-6 rounded-full transition-colors ${settings.invertY ? 'bg-cyan-500' : 'bg-gray-600'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.invertY ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div>
                <label className="text-gray-300 text-sm">Громкость: {Math.round(settings.masterVolume * 100)}%</label>
                <input type="range" min="0" max="1" step="0.05" value={settings.masterVolume}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setSettings({ ...settings, masterVolume: v });
                    audioManager.setMasterVolume(v);
                  }}
                  className="slider-game mt-1" />
              </div>
            </div>
            <button onClick={() => setShowSettings(false)} className="btn-game mt-6 w-full">Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
