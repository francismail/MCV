
export enum GameType {
    MAKE_TEN = 'MAKE_TEN',
    NUMBER_HOP = 'NUMBER_HOP',
    DOUBLES = 'DOUBLES',
    COUNT_UP = 'COUNT_UP'
}

export enum PlayMode {
    TIMED = 'TIMED',
    FREE = 'FREE',
    STREAK = 'STREAK'
}

export type MasteryRating = 'Diamond' | 'Iron' | 'Wood';

export interface TestResult {
    score: number;
    rating: MasteryRating;
    time: number;
    gameType: GameType;
}

export interface AppState {
    emeralds: number;
    xp: number;
    level: number;
    testScores: Record<string, number>;
    unlockedItems: string[];
    equippedItem: string;
    hearts: number;
    successCounts: Record<string, number>;
    isLocked: Record<string, boolean>;
    otherSuccessesSinceLock: Record<string, number>;
    currentPlayMode: PlayMode;
    streak: number;
}

export interface Settings {
    range: 10 | 20;
    ops: 'plus' | 'minus' | 'mixed';
    sessionTimer: number;
    testTimer: number;
    soundOn: boolean;
    oneHandedMode: 'off' | 'left' | 'right';
    assistMode: boolean;
}
