
import { AppState, Settings, PlayMode } from './types';

export const INITIAL_STATE: AppState = {
    emeralds: 0,
    xp: 0,
    level: 1,
    testScores: {},
    unlockedItems: ['base-char'],
    equippedItem: 'base-char',
    hearts: 3,
    successCounts: {
        MAKE_TEN: 0,
        NUMBER_HOP: 0,
        DOUBLES: 0,
        COUNT_UP: 0
    },
    isLocked: {
        MAKE_TEN: false,
        NUMBER_HOP: false,
        DOUBLES: false,
        COUNT_UP: false
    },
    otherSuccessesSinceLock: {
        MAKE_TEN: 0,
        NUMBER_HOP: 0,
        DOUBLES: 0,
        COUNT_UP: 0
    },
    currentPlayMode: PlayMode.TIMED,
    streak: 0
};

export const INITIAL_SETTINGS: Settings = {
    range: 10,
    ops: 'plus',
    sessionTimer: 5,
    testTimer: 60,
    soundOn: true,
    oneHandedMode: 'off',
    assistMode: false
};

export const CRAFT_OBJECTS = ['🧱', '🐶', '🍦', '💰', '🍎', '⚽', '🚗', '🐱', '🍪', '💎', '🧸', '🍭'];

export const SHOP_ITEMS = [
    { id: 'wood-tile', name: 'Oak Floor', price: 10, icon: '🪵' },
    { id: 'stone-tile', name: 'Stone Path', price: 25, icon: '🪨' },
    { id: 'steve', name: 'Miner Bob', price: 50, icon: '👷' },
    { id: 'zombie', name: 'Zombo', price: 100, icon: '🧟' },
    { id: 'creeper', name: 'Boomer', price: 200, icon: '🟩' },
    { id: 'diamond-block', name: 'Shiny Block', price: 500, icon: '💎' },
];

export const MasteryColors = {
    Diamond: 'text-cyan-700',
    Iron: 'text-stone-600',
    Wood: 'text-amber-900'
};
