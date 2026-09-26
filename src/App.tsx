import { useState, useEffect, useRef, useCallback } from 'react';
import { GameEngine, GameSettings, GameState, MISSIONS } from './game/engine';
import { audioManager } from './game/audio';

// ===================== НАЧАЛЬНЫЕ ЗНАЧЕНИЯ =====================

const DEFAULT_SETTINGS: GameSettings = {
  mouseSensX: 5,
  mouseSensY: 5,
  invertY: false,
  masterVolume: 0.7,
  sfxVolume: 0.8,
  musicVolume: 0.3,
  quality: 'medium',
  language: 'ru',
};

const DEFAULT_STATE: GameState = {
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
  upgrades: { maxHP: 0, batteryCapacity: 0, bombDamage: 0, repairSpeed: 0, stealth: 0, extraBombs: 0 },
  droneAlt: 0,
  droneSpeed: 0,
  droneThrottle: 0,
};

// ===================== КОМПОНЕНТЫ UI =====================

function MainMenu({ onPlay, onTutorial, onSettings, onRecords, onAbout }: {
  onPlay: () => void;
  onTutorial: () => void;
  onSettings: () => void;
  onRecords: () => void;
  onAbout: () => void;
}) {
  return (
    <div className="menu-overlay flex flex-col items-center justify-center gap-6">
      {/* Логотип */}
      <div className="text-center mb-8">
        <h1 className="text-6xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-orange-400 drop-shadow-lg">
          FPV STRIKE
        </h1>
        <p className="text-cyan-300/70 text-lg mt-2 tracking-wider">БОЕВОЙ FPV-ДРОН</p>
        <div className="w-64 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent mx-auto mt-4" />
      </div>

      {/* Кнопки */}
      <div className="flex flex-col gap-3 w-64">
        <button onClick={onPlay} className="btn-game-primary text-center">
          ▶ Играть
        </button>
        <button onClick={onTutorial} className="btn-game text-center">
          🎓 Обучение
        </button>
        <button onClick={onSettings} className="btn-game text-center">
          ⚙ Настройки
        </button>
        <button onClick={onRecords} className="btn-game text-center">
          🏆 Рекорды
        </button>
        <button onClick={onAbout} className="btn-game text-center">
          ℹ Об игре
        </button>
      </div>

      {/* Версия */}
      <div className="absolute bottom-4 text-gray-500 text-sm">
        v1.0 | Three.js + React
      </div>
    </div>
  );
}

function SettingsModal({ settings, onChange, onClose, onReset }: {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  return (
    <div className="menu-overlay" onClick={onClose}>
      <div className="bg-gray-900/95 border border-cyan-400/30 rounded-lg p-8 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-cyan-400 mb-6">⚙ Настройки</h2>
        
        <div className="space-y-5">
          {/* Чувствительность мыши X */}
          <div>
            <label className="text-gray-300 text-sm">Чувствительность мыши X: {settings.mouseSensX.toFixed(1)}</label>
            <input type="range" min="1" max="20" step="0.5" value={settings.mouseSensX}
              onChange={e => onChange({ ...settings, mouseSensX: parseFloat(e.target.value) })}
              className="slider-game mt-1" />
          </div>
          
          {/* Чувствительность мыши Y */}
          <div>
            <label className="text-gray-300 text-sm">Чувствительность мыши Y: {settings.mouseSensY.toFixed(1)}</label>
            <input type="range" min="1" max="20" step="0.5" value={settings.mouseSensY}
              onChange={e => onChange({ ...settings, mouseSensY: parseFloat(e.target.value) })}
              className="slider-game mt-1" />
          </div>
          
          {/* Инверсия Y */}
          <div className="flex items-center justify-between">
            <span className="text-gray-300 text-sm">Инверсия оси Y</span>
            <button onClick={() => onChange({ ...settings, invertY: !settings.invertY })}
              className={`w-12 h-6 rounded-full transition-colors ${settings.invertY ? 'bg-cyan-500' : 'bg-gray-600'}`}>
              <div className={`w-5 h-5 bg-white rounded-full transition-transform ${settings.invertY ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
          
          {/* Громкость */}
          <div>
            <label className="text-gray-300 text-sm">Общая громкость: {Math.round(settings.masterVolume * 100)}%</label>
            <input type="range" min="0" max="1" step="0.05" value={settings.masterVolume}
              onChange={e => onChange({ ...settings, masterVolume: parseFloat(e.target.value) })}
              className="slider-game mt-1" />
          </div>
          
          <div>
            <label className="text-gray-300 text-sm">Звуки эффектов: {Math.round(settings.sfxVolume * 100)}%</label>
            <input type="range" min="0" max="1" step="0.05" value={settings.sfxVolume}
              onChange={e => onChange({ ...settings, sfxVolume: parseFloat(e.target.value) })}
              className="slider-game mt-1" />
          </div>
          
          <div>
            <label className="text-gray-300 text-sm">Музыка: {Math.round(settings.musicVolume * 100)}%</label>
            <input type="range" min="0" max="1" step="0.05" value={settings.musicVolume}
              onChange={e => onChange({ ...settings, musicVolume: parseFloat(e.target.value) })}
              className="slider-game mt-1" />
          </div>
          
          {/* Качество */}
          <div>
            <label className="text-gray-300 text-sm block mb-2">Качество графики</label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map(q => (
                <button key={q} onClick={() => onChange({ ...settings, quality: q })}
                  className={`px-4 py-2 rounded text-sm font-bold transition-colors ${
                    settings.quality === q 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}>
                  {q === 'low' ? 'Низкое' : q === 'medium' ? 'Среднее' : 'Высокое'}
                </button>
              ))}
            </div>
          </div>
          
          {/* Язык */}
          <div>
            <label className="text-gray-300 text-sm block mb-2">Язык</label>
            <div className="flex gap-2">
              {(['ru', 'en'] as const).map(l => (
                <button key={l} onClick={() => onChange({ ...settings, language: l })}
                  className={`px-4 py-2 rounded text-sm font-bold transition-colors ${
                    settings.language === l 
                      ? 'bg-cyan-500 text-black' 
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}>
                  {l === 'ru' ? 'Русский' : 'English'}
                </button>
              ))}
            </div>
          </div>
          
          {/* Сброс */}
          <div className="pt-4 border-t border-gray-700">
            <button onClick={onReset}
              className="text-red-400 hover:text-red-300 text-sm underline">
              🗑 Сбросить прогресс
            </button>
          </div>
        </div>
        
        <button onClick={onClose} className="btn-game mt-6 w-full">
          Закрыть
        </button>
      </div>
    </div>
  );
}

function MissionSelect({ currentMission, onStart, onBack, score }: {
  currentMission: number;
  onStart: (idx: number) => void;
  onBack: () => void;
  score: number;
}) {
  return (
    <div className="menu-overlay flex flex-col items-center justify-center gap-4">
      <h2 className="text-3xl font-bold text-cyan-400 mb-4">ВЫБОР МИССИИ</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl w-full px-4">
        {MISSIONS.map((mission, idx) => (
          <button
            key={idx}
            onClick={() => onStart(idx)}
            disabled={idx > currentMission && idx > 0}
            className={`p-4 rounded-lg border text-left transition-all ${
              idx <= currentMission || idx === 0
                ? 'border-cyan-400/50 bg-gray-800/80 hover:bg-gray-700/80 hover:border-cyan-400 cursor-pointer'
                : 'border-gray-600/30 bg-gray-900/50 opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white">
                  {idx + 1}. {mission.name}
                </h3>
                <p className="text-gray-400 text-sm mt-1">{mission.description}</p>
                <p className="text-gray-500 text-xs mt-2">
                  ⏱ {Math.floor(mission.timeLimit / 60)}:{(mission.timeLimit % 60).toString().padStart(2, '0')} | 
                  👾 {mission.enemies.length} врагов
                </p>
              </div>
              {idx < currentMission && (
                <span className="text-yellow-400 text-xl">⭐</span>
              )}
            </div>
          </button>
        ))}
      </div>
      
      <div className="flex gap-4 mt-4">
        <button onClick={onBack} className="btn-game">← Назад</button>
      </div>
      
      <div className="text-yellow-400 mt-2">
        💰 Монеты: {score} | Очки: {score}
      </div>
    </div>
  );
}

function PauseMenu({ onResume, onSettings, onRestart, onQuit }: {
  onResume: () => void;
  onSettings: () => void;
  onRestart: () => void;
  onQuit: () => void;
}) {
  return (
    <div className="menu-overlay">
      <div className="bg-gray-900/95 border border-cyan-400/30 rounded-lg p-8 text-center">
        <h2 className="text-3xl font-bold text-cyan-400 mb-6">⏸ ПАУЗА</h2>
        
        <div className="flex flex-col gap-3 w-56 mx-auto">
          <button onClick={onResume} className="btn-game-primary">▶ Продолжить</button>
          <button onClick={onSettings} className="btn-game">⚙ Настройки</button>
          <button onClick={onRestart} className="btn-game">🔄 Рестарт</button>
          <button onClick={onQuit} className="btn-game">🚪 Выйти в меню</button>
        </div>
      </div>
    </div>
  );
}

function VictoryScreen({ state, onNext, onRetry, onMenu }: {
  state: GameState;
  onNext: () => void;
  onRetry: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="menu-overlay">
      <div className="bg-gray-900/95 border border-green-400/30 rounded-lg p-8 text-center max-w-md">
        <h2 className="text-4xl font-bold text-green-400 mb-2">🎉 ПОБЕДА!</h2>
        <p className="text-gray-400 mb-4">Миссия выполнена</p>
        
        {/* Звёзды */}
        <div className="text-4xl mb-4">
          {[1, 2, 3].map(i => (
            <span key={i} className={i <= state.stars ? 'text-yellow-400' : 'text-gray-600'}>★</span>
          ))}
        </div>
        
        {/* Статистика */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-6 text-left space-y-2">
          <div className="flex justify-between text-gray-300">
            <span>⏱ Время:</span>
            <span>{Math.floor(state.time / 60)}:{Math.floor(state.time % 60).toString().padStart(2, '0')}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>💀 Убийства:</span>
            <span>{state.kills}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>🎯 Точность:</span>
            <span>{Math.round(state.accuracy * 100)}%</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>🏆 Очки:</span>
            <span className="text-yellow-400">{state.score}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>💰 Монеты:</span>
            <span className="text-yellow-400">+{state.stars * 100}</span>
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          {state.currentMission < MISSIONS.length - 1 && (
            <button onClick={onNext} className="btn-game-primary">Следующая миссия →</button>
          )}
          <button onClick={onRetry} className="btn-game">🔄 Повторить</button>
          <button onClick={onMenu} className="btn-game">🏠 В меню</button>
        </div>
      </div>
    </div>
  );
}

function DefeatScreen({ state, onRetry, onMenu }: {
  state: GameState;
  onRetry: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="menu-overlay">
      <div className="bg-gray-900/95 border border-red-400/30 rounded-lg p-8 text-center max-w-md">
        <h2 className="text-4xl font-bold text-red-400 mb-2">💥 ПРОВАЛ</h2>
        <p className="text-gray-400 mb-4">
          {state.battery <= 0 ? 'Батарея разряжена' : 'Дрон уничтожен'}
        </p>
        
        <div className="bg-gray-800/50 rounded-lg p-4 mb-6 text-left space-y-2">
          <div className="flex justify-between text-gray-300">
            <span>⏱ Время:</span>
            <span>{Math.floor(state.time / 60)}:{Math.floor(state.time % 60).toString().padStart(2, '0')}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>💀 Убийства:</span>
            <span>{state.kills}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span>🏆 Очки:</span>
            <span>{state.score}</span>
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          <button onClick={onRetry} className="btn-game-primary">🔄 Попробовать снова</button>
          <button onClick={onMenu} className="btn-game">🏠 В меню</button>
        </div>
      </div>
    </div>
  );
}

function ShopScreen({ coins, upgrades, onBuy, onBack }: {
  coins: number;
  upgrades: GameState['upgrades'];
  onBuy: (key: keyof GameState['upgrades'], cost: number) => void;
  onBack: () => void;
}) {
  const items = [
    { key: 'maxHP' as const, name: 'Броня +20 HP', cost: 200, icon: '🛡', level: upgrades.maxHP, max: 5 },
    { key: 'batteryCapacity' as const, name: 'Батарея +30%', cost: 150, icon: '🔋', level: upgrades.batteryCapacity, max: 3 },
    { key: 'bombDamage' as const, name: 'Мощность бомб +25%', cost: 250, icon: '💣', level: upgrades.bombDamage, max: 4 },
    { key: 'repairSpeed' as const, name: 'Скорость ремонта', cost: 180, icon: '🔧', level: upgrades.repairSpeed, max: 3 },
    { key: 'stealth' as const, name: 'Скрытность', cost: 300, icon: '👻', level: upgrades.stealth, max: 3 },
    { key: 'extraBombs' as const, name: '+1 бомба', cost: 100, icon: '🎯', level: upgrades.extraBombs, max: 5 },
  ];

  return (
    <div className="menu-overlay flex flex-col items-center justify-center gap-4">
      <h2 className="text-3xl font-bold text-yellow-400">🛒 МАГАЗИН</h2>
      <p className="text-yellow-300">💰 Монеты: {coins}</p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full px-4">
        {items.map(item => (
          <div key={item.key} className="bg-gray-800/80 border border-gray-600/50 rounded-lg p-4 flex items-center justify-between">
            <div>
              <div className="text-white font-bold">{item.icon} {item.name}</div>
              <div className="text-gray-400 text-sm">Уровень: {item.level}/{item.max}</div>
            </div>
            <button
              onClick={() => onBuy(item.key, item.cost)}
              disabled={coins < item.cost || item.level >= item.max}
              className={`px-3 py-1 rounded text-sm font-bold ${
                coins >= item.cost && item.level < item.max
                  ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {item.level >= item.max ? 'MAX' : `${item.cost} 💰`}
            </button>
          </div>
        ))}
      </div>
      
      <button onClick={onBack} className="btn-game mt-4">← Назад</button>
    </div>
  );
}

function RecordsScreen({ score, onBack }: { score: number; onBack: () => void }) {
  const records = JSON.parse(localStorage.getItem('fpvStrike_records') || '[]');
  
  const achievements = [
    { name: 'Первая кровь', desc: 'Уничтожить первого врага', icon: '🎯', condition: score > 0 },
    { name: 'Снайпер', desc: 'Точность выше 70%', icon: '🔫', condition: false },
    { name: 'Неуязвимый', desc: 'Пройти миссию без урона', icon: '🛡', condition: false },
    { name: 'Скорость света', desc: 'Пройти миссию за половину времени', icon: '⚡', condition: false },
    { name: 'Коллекционер', desc: 'Собрать 500 монет', icon: '💰', condition: score >= 500 },
    { name: 'Ветеран', desc: 'Пройти 3 миссии', icon: '🎖', condition: false },
    { name: 'Уничтожитель', desc: 'Убить 50 врагов', icon: '💀', condition: false },
    { name: 'Босс- Killer', desc: 'Уничтожить босса', icon: '👑', condition: false },
  ];
  
  return (
    <div className="menu-overlay flex flex-col items-center justify-center gap-4 overflow-y-auto py-8">
      <h2 className="text-3xl font-bold text-yellow-400">🏆 РЕКОРДЫ И ДОСТИЖЕНИЯ</h2>
      
      <div className="flex gap-4 max-w-3xl w-full px-4">
        {/* Рекорды */}
        <div className="bg-gray-800/80 border border-gray-600/50 rounded-lg p-5 flex-1">
          <h3 className="text-lg font-bold text-cyan-400 mb-3 text-center">Рекорды</h3>
          <div className="text-center mb-4">
            <p className="text-gray-400 text-sm">Лучший счёт</p>
            <p className="text-3xl font-bold text-yellow-400">{score}</p>
          </div>
          
          {records.length > 0 ? (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {records.slice(0, 10).map((r: any, i: number) => (
                <div key={i} className="flex justify-between text-gray-300 text-xs border-b border-gray-700 pb-1">
                  <span>Миссия {r.mission + 1}</span>
                  <span>{r.score} очков | {r.stars}⭐</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center text-sm">Пока нет рекордов</p>
          )}
        </div>
        
        {/* Достижения */}
        <div className="bg-gray-800/80 border border-gray-600/50 rounded-lg p-5 flex-1">
          <h3 className="text-lg font-bold text-yellow-400 mb-3 text-center">Достижения</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {achievements.map((a, i) => (
              <div key={i} className={`flex items-center gap-2 p-2 rounded ${a.condition ? 'bg-yellow-400/10 border border-yellow-400/30' : 'opacity-50'}`}>
                <span className="text-lg">{a.icon}</span>
                <div>
                  <div className={`text-xs font-bold ${a.condition ? 'text-yellow-400' : 'text-gray-400'}`}>{a.name}</div>
                  <div className="text-[10px] text-gray-500">{a.desc}</div>
                </div>
                {a.condition && <span className="ml-auto text-green-400 text-xs">✓</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      <button onClick={onBack} className="btn-game">← Назад</button>
    </div>
  );
}

function AboutScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="menu-overlay flex flex-col items-center justify-center gap-4">
      <div className="bg-gray-900/95 border border-cyan-400/30 rounded-lg p-8 max-w-lg text-center">
        <h2 className="text-3xl font-bold text-cyan-400 mb-4">ℹ ОБ ИГРЕ</h2>
        
        <div className="text-gray-300 space-y-3 text-left">
          <p><strong className="text-white">FPV STRIKE</strong> — аркадный симулятор боевого FPV-дрона.</p>
          <p>Управляйте дроном от первого лица, выполняйте боевые задачи, уничтожайте врагов!</p>
          
          <div className="bg-gray-800/50 rounded p-3 mt-4">
            <h3 className="text-cyan-400 font-bold mb-2">Управление:</h3>
            <ul className="text-sm space-y-1 text-gray-400">
              <li><kbd className="text-white">W/S</kbd> — тяга вперёд/назад</li>
              <li><kbd className="text-white">A/D</kbd> — крен влево/вправо</li>
              <li><kbd className="text-white">Мышь</kbd> — тангаж/рыскание</li>
              <li><kbd className="text-white">Space/Shift</kbd> — вверх/вниз</li>
              <li><kbd className="text-white">Q/E</kbd> — рыскание</li>
              <li><kbd className="text-white">ЛКМ</kbd> — сброс бомбы</li>
              <li><kbd className="text-white">ПКМ</kbd> — камикадзе</li>
              <li><kbd className="text-white">C</kbd> — сменить камеру</li>
              <li><kbd className="text-white">F</kbd> — вернуться на базу</li>
              <li><kbd className="text-white">ESC</kbd> — пауза</li>
            </ul>
          </div>
          
          <div className="bg-gray-800/50 rounded p-3">
            <h3 className="text-cyan-400 font-bold mb-2">Геймпад:</h3>
            <ul className="text-sm space-y-1 text-gray-400">
              <li>Левый стик — тяга + рыскание</li>
              <li>Правый стик — тангаж + крен</li>
            </ul>
          </div>
          
          <p className="text-gray-500 text-sm mt-4">
            Создано с Three.js, React и Web Audio API.<br/>
            Все звуки процедурные, графика — из примитивов.
          </p>
        </div>
      </div>
      
      <button onClick={onBack} className="btn-game">← Назад</button>
    </div>
  );
}

// ===================== HUD =====================

function GameHUD({ state, droneAlt, droneSpeed }: { state: GameState; droneAlt: number; droneSpeed: number }) {
  const hpPercent = (state.droneHP / state.droneMaxHP) * 100;
  const batteryPercent = state.battery;
  
  return (
    <div className="hud-overlay">
      {/* Верхний левый — HP и батарея */}
      <div className="absolute top-4 left-4 space-y-2">
        {/* HP */}
        <div className="flex items-center gap-2">
          <span className="text-red-400 text-sm font-bold w-8">HP</span>
          <div className="w-32 h-3 bg-gray-800 rounded overflow-hidden border border-gray-600">
            <div className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all"
              style={{ width: `${hpPercent}%` }} />
          </div>
          <span className="text-red-300 text-xs font-mono">{Math.round(state.droneHP)}</span>
        </div>
        
        {/* Батарея */}
        <div className="flex items-center gap-2">
          <span className="text-yellow-400 text-sm font-bold w-8">⚡</span>
          <div className="w-32 h-3 bg-gray-800 rounded overflow-hidden border border-gray-600">
            <div className={`h-full transition-all ${batteryPercent < 20 ? 'bg-red-500 warning-flash' : 'bg-gradient-to-r from-yellow-600 to-green-400'}`}
              style={{ width: `${batteryPercent}%` }} />
          </div>
          <span className="text-yellow-300 text-xs font-mono">{Math.round(batteryPercent)}%</span>
        </div>
        
        {/* Бомбы */}
        <div className="flex items-center gap-1 mt-1">
          <span className="text-orange-400 text-sm">💣</span>
          {Array.from({ length: state.maxBombs }).map((_, i) => (
            <div key={i} className={`w-3 h-5 rounded-sm ${i < state.bombs ? 'bg-orange-500' : 'bg-gray-700'}`} />
          ))}
        </div>
      </div>
      
      {/* Верхний правый — очки и время */}
      <div className="absolute top-4 right-4 text-right space-y-1">
        <div className="text-yellow-400 font-mono text-sm">🏆 {state.score}</div>
        <div className="text-yellow-300 font-mono text-sm">💰 {state.coins}</div>
        <div className="text-cyan-400 font-mono text-sm">
          Миссия {state.currentMission + 1}: {MISSIONS[state.currentMission]?.name || ''}
        </div>
        <div className="text-white font-mono text-lg">
          ⏱ {Math.floor(state.time / 60)}:{Math.floor(state.time % 60).toString().padStart(2, '0')}
        </div>
      </div>
      
      {/* Центр — прицел */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        <div className="relative w-8 h-8">
          <div className="absolute top-0 left-1/2 w-0.5 h-2 bg-cyan-400/70 -translate-x-1/2" />
          <div className="absolute bottom-0 left-1/2 w-0.5 h-2 bg-cyan-400/70 -translate-x-1/2" />
          <div className="absolute left-0 top-1/2 w-2 h-0.5 bg-cyan-400/70 -translate-y-1/2" />
          <div className="absolute right-0 top-1/2 w-2 h-0.5 bg-cyan-400/70 -translate-y-1/2" />
          <div className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full border border-cyan-400/70 -translate-x-1/2 -translate-y-1/2" />
        </div>
      </div>
      
      {/* Нижний центр — высота, скорость, координаты */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-center">
        <div className="bg-black/50 rounded px-4 py-2 border border-cyan-400/20">
          <div className="flex gap-6 text-xs font-mono">
            <div className="text-green-400">
              ALT <span className="text-white">{droneAlt.toFixed(1)}</span>m
            </div>
            <div className="text-blue-400">
              SPD <span className="text-white">{droneSpeed.toFixed(1)}</span>м/с
            </div>
            <div className="text-gray-400">
              CAM: <span className="text-cyan-400 uppercase">{state.cameraMode}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Левый список задач */}
      <div className="absolute top-24 left-4 space-y-1">
        {state.missionObjectives.map((obj, i) => (
          <div key={i} className={`text-xs font-mono ${obj.completed ? 'text-green-400 line-through' : 'text-gray-300'}`}>
            {obj.completed ? '✓' : '○'} {obj.text}
          </div>
        ))}
      </div>
      
      {/* Предупреждения */}
      {state.warnings.length > 0 && (
        <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2">
          {state.warnings.map((w, i) => (
            <div key={i} className="text-red-400 text-lg font-bold warning-flash text-center mb-1">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
      
      {/* Подсказки управления (первые 30 секунд) */}
      {state.time < 30 && (
        <div className="absolute bottom-16 left-1/2 transform -translate-x-1/2 text-center">
          <div className="bg-black/60 rounded px-4 py-2 text-xs text-gray-400 font-mono">
            WASD — управление | Мышь — камера | ЛКМ — бомба | C — камера | F — база
          </div>
        </div>
      )}
      
      {/* Режим камеры */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2">
        <div className="bg-black/50 rounded px-3 py-1 text-xs text-cyan-400 font-mono border border-cyan-400/20">
          FPV {state.cameraMode.toUpperCase()}
        </div>
      </div>
      
      {/* Искусственный горизонт (простой) */}
      <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2">
        <div className="w-24 h-12 bg-black/40 rounded border border-gray-600/50 relative overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full h-px bg-green-400/70" />
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[8px] text-green-400/70">
            ── ✦ ──
          </div>
        </div>
      </div>
      
      {/* Индикатор газа */}
      <div className="absolute left-4 bottom-20">
        <div className="w-3 h-24 bg-gray-800/80 rounded border border-gray-600/50 relative overflow-hidden">
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-green-500 to-yellow-400 transition-all"
            style={{ height: `${state.droneThrottle * 100}%` }} />
          <div className="absolute -left-4 top-0 text-[8px] text-gray-400">GAS</div>
        </div>
      </div>
      
      {/* Миникарта */}
      <div className="absolute bottom-4 right-4">
        <div className="w-36 h-36 bg-black/80 rounded-lg border border-cyan-400/30 relative overflow-hidden">
          {/* Сетка */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-400/50" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-400/50" />
          </div>
          {/* Точка игрока (центр) */}
          <div className="absolute top-1/2 left-1/2 w-2.5 h-2.5 bg-cyan-400 rounded-full -translate-x-1/2 -translate-y-1/2 shadow-lg shadow-cyan-400/50" />
          {/* Индикатор направления */}
          <div className="absolute top-1/2 left-1/2 w-0 h-0 -translate-x-1/2 -translate-y-1/2"
            style={{ borderLeft: '3px solid transparent', borderRight: '3px solid transparent', borderBottom: '6px solid cyan', transform: 'translate(-50%, -100%)' }} />
          {/* База (зелёная) */}
          <div className="absolute bottom-3 left-3 w-2 h-2 bg-green-400 rounded-sm" title="База" />
          {/* Метка севера */}
          <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] text-cyan-400/70 font-bold">N</div>
          {/* Масштаб */}
          <div className="absolute bottom-1 right-1 text-[7px] text-gray-500">200m</div>
        </div>
      </div>
      
      {/* Scanlines overlay */}
      <div className="absolute inset-0 scanline pointer-events-none opacity-30" />
    </div>
  );
}

// ===================== ГЛАВНЫЙ КОМПОНЕНТ =====================

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [gameState, setGameState] = useState<GameState>(DEFAULT_STATE);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [screen, setScreen] = useState<'menu' | 'missions' | 'shop' | 'records' | 'about'>('menu');
  const [pauseSettings, setPauseSettings] = useState(false);

  // Инициализация движка
  useEffect(() => {
    if (!containerRef.current) return;
    
    const engine = new GameEngine(containerRef.current, settings);
    engineRef.current = engine;
    
    engine.onStateChange = (state) => {
      setGameState(state);
    };
    
    engine.loadProgress();
    engine.start();
    engine.startMenuAnimation();
    
    // Инициализация аудио при первом клике
    const initAudio = () => {
      audioManager.init();
      audioManager.resume();
      audioManager.setMasterVolume(settings.masterVolume);
      audioManager.setSfxVolume(settings.sfxVolume);
      audioManager.setMusicVolume(settings.musicVolume);
      audioManager.startMenuMusic();
      document.removeEventListener('click', initAudio);
    };
    document.addEventListener('click', initAudio);
    
    return () => {
      engine.dispose();
      document.removeEventListener('click', initAudio);
    };
  }, []);

  // Обновление настроек
  const handleSettingsChange = useCallback((newSettings: GameSettings) => {
    setSettings(newSettings);
    if (engineRef.current) {
      engineRef.current.updateSettings(newSettings);
    }
    audioManager.setMasterVolume(newSettings.masterVolume);
    audioManager.setSfxVolume(newSettings.sfxVolume);
    audioManager.setMusicVolume(newSettings.musicVolume);
  }, []);

  // Навигация
  const handlePlay = () => {
    audioManager.playClick();
    audioManager.stopMenuMusic();
    setScreen('missions');
  };

  const handleTutorial = () => {
    audioManager.playClick();
    audioManager.stopMenuMusic();
    if (engineRef.current) {
      engineRef.current.startMission(0);
    }
  };

  const handleStartMission = (idx: number) => {
    audioManager.playClick();
    if (engineRef.current) {
      engineRef.current.startMission(idx);
    }
  };

  const handleBack = () => {
    audioManager.playClick();
    setScreen('menu');
    if (engineRef.current) {
      engineRef.current.state.phase = 'menu';
      engineRef.current.startMenuAnimation();
      audioManager.startMenuMusic();
    }
  };

  const handleResume = () => {
    audioManager.playClick();
    if (engineRef.current) {
      engineRef.current.resume();
    }
  };

  const handleRestart = () => {
    audioManager.playClick();
    if (engineRef.current) {
      engineRef.current.startMission(gameState.currentMission);
    }
  };

  const handleNextMission = () => {
    audioManager.playClick();
    if (engineRef.current && gameState.currentMission < MISSIONS.length - 1) {
      engineRef.current.startMission(gameState.currentMission + 1);
    }
  };

  const handleQuit = () => {
    audioManager.playClick();
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current.state.phase = 'menu';
      engineRef.current.startMenuAnimation();
    }
    setScreen('menu');
    audioManager.startMenuMusic();
  };

  const handleReset = () => {
    if (confirm('Вы уверены? Весь прогресс будет удалён!')) {
      if (engineRef.current) {
        engineRef.current.resetProgress();
      }
      setGameState(prev => ({ ...prev, score: 0, coins: 0, currentMission: 0 }));
    }
  };

  const handleBuyUpgrade = (key: keyof GameState['upgrades'], cost: number) => {
    audioManager.playPickup();
    if (gameState.coins >= cost) {
      setGameState(prev => ({
        ...prev,
        coins: prev.coins - cost,
        upgrades: { ...prev.upgrades, [key]: prev.upgrades[key] + 1 },
      }));
      if (engineRef.current) {
        engineRef.current.state.coins -= cost;
        engineRef.current.state.upgrades[key]++;
        engineRef.current.saveProgress();
      }
    }
  };

  // Рендер экранов
  const renderScreen = () => {
    switch (screen) {
      case 'missions':
        return <MissionSelect currentMission={gameState.currentMission} onStart={handleStartMission} onBack={handleBack} score={gameState.score} />;
      case 'shop':
        return <ShopScreen coins={gameState.coins} upgrades={gameState.upgrades} onBuy={handleBuyUpgrade} onBack={handleBack} />;
      case 'records':
        return <RecordsScreen score={gameState.score} onBack={handleBack} />;
      case 'about':
        return <AboutScreen onBack={handleBack} />;
      default:
        return (
          <MainMenu
            onPlay={handlePlay}
            onTutorial={handleTutorial}
            onSettings={() => { audioManager.playClick(); setShowSettings(true); }}
            onRecords={() => { audioManager.playClick(); setScreen('records'); }}
            onAbout={() => { audioManager.playClick(); setScreen('about'); }}
          />
        );
    }
  };

  // Рендер игровых экранов
  const renderGameScreen = () => {
    switch (gameState.phase) {
      case 'paused':
        return (
          <PauseMenu
            onResume={handleResume}
            onSettings={() => setPauseSettings(true)}
            onRestart={handleRestart}
            onQuit={handleQuit}
          />
        );
      case 'victory':
        return <VictoryScreen state={gameState} onNext={handleNextMission} onRetry={handleRestart} onMenu={handleQuit} />;
      case 'defeat':
        return <DefeatScreen state={gameState} onRetry={handleRestart} onMenu={handleQuit} />;
      default:
        return null;
    }
  };

  const isInGame = gameState.phase === 'playing' || gameState.phase === 'paused' || gameState.phase === 'victory' || gameState.phase === 'defeat';

  return (
    <div className="w-full h-full relative">
      {/* Canvas контейнер */}
      <div ref={containerRef} className="game-canvas" />
      
      {/* UI */}
      {!isInGame && renderScreen()}
      
      {/* HUD во время игры */}
      {gameState.phase === 'playing' && <GameHUD state={gameState} droneAlt={gameState.droneAlt} droneSpeed={gameState.droneSpeed} />}
      
      {/* Экраны паузы/победы/поражения */}
      {isInGame && renderGameScreen()}
      
      {/* Модальные окна настроек */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
          onReset={handleReset}
        />
      )}
      {pauseSettings && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setPauseSettings(false)}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
