/**
 * AudioManager — процедурный звук через Web Audio API
 * Все звуки генерируются осцилляторами и шумом
 */

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  
  private masterVolume = 0.7;
  private sfxVolume = 0.8;
  private musicVolume = 0.3;
  private uiVolume = 0.5;
  private muted = false;

  // Активные звуки для управления
  private motorOsc: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private windNoise: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private musicInterval: number | null = null;

  constructor() {
    // Инициализация при первом взаимодействии
  }

  init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    
    // Создаём микшер
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.masterGain.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.masterGain);

    this.uiGain = this.ctx.createGain();
    this.uiGain.gain.value = this.uiVolume;
    this.uiGain.connect(this.masterGain);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // === Громкость ===
  setMasterVolume(v: number) {
    this.masterVolume = v;
    if (this.masterGain) this.masterGain.gain.value = this.muted ? 0 : v;
  }

  setSfxVolume(v: number) {
    this.sfxVolume = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }

  setMusicVolume(v: number) {
    this.musicVolume = v;
    if (this.musicGain) this.musicGain.gain.value = v;
  }

  setUiVolume(v: number) {
    this.uiVolume = v;
    if (this.uiGain) this.uiGain.gain.value = v;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.masterGain) this.masterGain.gain.value = m ? 0 : this.masterVolume;
  }

  // === Утилиты ===
  private createNoise(duration: number): AudioBufferSourceNode {
    if (!this.ctx) throw new Error('Audio not initialized');
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    if (!this.ctx) throw new Error('Audio not initialized');
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // === Звуки моторов дрона ===
  startMotorSound() {
    if (!this.ctx || !this.sfxGain) return;
    
    this.motorOsc = this.ctx.createOscillator();
    this.motorOsc.type = 'sawtooth';
    this.motorOsc.frequency.value = 120;

    this.motorGain = this.ctx.createGain();
    this.motorGain.gain.value = 0.15;

    // Фильтр для более реалистичного звука
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 2;

    this.motorOsc.connect(filter);
    filter.connect(this.motorGain);
    this.motorGain.connect(this.sfxGain);
    this.motorOsc.start();
  }

  updateMotorSound(throttle: number) {
    if (!this.motorOsc || !this.motorGain) return;
    // Частота зависит от газа
    this.motorOsc.frequency.value = 80 + throttle * 200;
    this.motorGain.gain.value = 0.05 + throttle * 0.15;
  }

  stopMotorSound() {
    if (this.motorOsc) {
      this.motorOsc.stop();
      this.motorOsc = null;
    }
    this.motorGain = null;
  }

  // === Ветер ===
  startWind() {
    if (!this.ctx || !this.sfxGain) return;
    
    const noise = this.createNoise(2);
    noise.loop = true;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.5;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.05;

    noise.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.sfxGain);
    noise.start();
    this.windNoise = noise;
  }

  updateWind(speed: number) {
    if (!this.windGain) return;
    this.windGain.gain.value = Math.min(0.2, speed * 0.01);
  }

  stopWind() {
    if (this.windNoise) {
      this.windNoise.stop();
      this.windNoise = null;
    }
    this.windGain = null;
  }

  // === Выстрел ===
  playShot() {
    if (!this.ctx || !this.sfxGain) return;
    
    const now = this.ctx.currentTime;
    
    // Импульс
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 150;
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);

    const gain = this.ctx.createGain();
    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.15);

    // Шум
    const noise = this.createNoise(0.1);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.2;
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    
    noise.connect(noiseGain);
    noiseGain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.1);
  }

  // === Взрыв ===
  playExplosion(size: number = 1) {
    if (!this.ctx || !this.sfxGain) return;
    
    const now = this.ctx.currentTime;
    const duration = 0.5 + size * 0.5;
    
    // Низкочастотный бум
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 60 * size;
    osc.frequency.exponentialRampToValueAtTime(20, now + duration);

    const oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.5 * size;
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration);

    // Шум взрыва
    const noise = this.createNoise(duration);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);

    const noiseGainNode = this.ctx.createGain();
    noiseGainNode.gain.value = 0.4 * size;
    noiseGainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(noiseGainNode);
    noiseGainNode.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + duration);

    // Дисторшн через waveshaper
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
  }

  // === Попадание ===
  playHit() {
    if (!this.ctx || !this.sfxGain) return;
    
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 800;
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);

    const gain = this.ctx.createGain();
    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // === Предупреждение ===
  playWarning() {
    if (!this.ctx || !this.uiGain) return;
    
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 880;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.15;
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.setValueAtTime(0, now + 0.1);
    gain.gain.setValueAtTime(0.15, now + 0.2);
    gain.gain.setValueAtTime(0, now + 0.3);

    osc.connect(gain);
    gain.connect(this.uiGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // === UI клик ===
  playClick() {
    if (!this.ctx || !this.uiGain) return;
    
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1200;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.uiGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  // === Звук подбора бонуса ===
  playPickup() {
    if (!this.ctx || !this.sfxGain) return;
    
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);

    const gain = this.ctx.createGain();
    gain.gain.value = 0.2;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  // === Звук уничтожения врага ===
  playEnemyDestroyed() {
    if (!this.ctx || !this.sfxGain) return;
    
    const now = this.ctx.currentTime;
    
    // Нисходящий тон
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 600;
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.value = 0.2;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  // === Фоновая музыка меню ===
  startMenuMusic() {
    if (!this.ctx || !this.musicGain) return;
    if (this.musicInterval) return;

    const notes = [261.6, 329.6, 392.0, 523.3, 392.0, 329.6]; // C E G C G E
    let noteIndex = 0;

    const playNote = () => {
      if (!this.ctx || !this.musicGain) return;
      const now = this.ctx.currentTime;
      
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = notes[noteIndex % notes.length];

      const gain = this.ctx.createGain();
      gain.gain.value = 0.08;
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

      osc.connect(gain);
      gain.connect(this.musicGain!);
      osc.start(now);
      osc.stop(now + 0.8);

      noteIndex++;
    };

    playNote();
    this.musicInterval = window.setInterval(playNote, 600);
  }

  stopMenuMusic() {
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }

  // === Звук ракетного двигателя ===
  playRocketLaunch() {
    if (!this.ctx || !this.sfxGain) return;
    
    const now = this.ctx.currentTime;
    
    // Шипение
    const noise = this.createNoise(1);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.8);

    // Свист
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 500;
    osc.frequency.exponentialRampToValueAtTime(2000, now + 0.5);

    const oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.1;
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(oscGain);
    oscGain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.6);
  }

  // === Очистка ===
  dispose() {
    this.stopMotorSound();
    this.stopWind();
    this.stopMenuMusic();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}

export const audioManager = new AudioManager();
