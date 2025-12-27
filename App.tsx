
import React, { useState, useEffect, useCallback } from 'react';
import { 
    Hub, 
    GameScreen, 
    ResultsScreen, 
    ParentPanel, 
    ShopScreen, 
    TestSelection,
    HUD 
} from './components/Screens';
import { GameType, AppState, Settings, TestResult, PlayMode } from './types';
import { INITIAL_STATE, INITIAL_SETTINGS } from './constants';

const App: React.FC = () => {
    const [state, setState] = useState<AppState>(() => {
        const saved = localStorage.getItem('mathVillageData');
        return saved ? JSON.parse(saved) : INITIAL_STATE;
    });

    const [settings, setSettings] = useState<Settings>(() => {
        const saved = localStorage.getItem('mathVillageSettings');
        return saved ? JSON.parse(saved) : INITIAL_SETTINGS;
    });

    const [currentView, setCurrentView] = useState<'hub' | 'game' | 'results' | 'shop' | 'parent' | 'test-select'>('hub');
    const [activeGame, setActiveGame] = useState<GameType | null>(null);
    const [playMode, setPlayMode] = useState<PlayMode>(PlayMode.TIMED);
    const [isTestMode, setIsTestMode] = useState(false);
    const [lastGameResult, setLastGameResult] = useState<TestResult | null>(null);

    useEffect(() => {
        localStorage.setItem('mathVillageData', JSON.stringify(state));
    }, [state]);

    useEffect(() => {
        localStorage.setItem('mathVillageSettings', JSON.stringify(settings));
    }, [settings]);

    const addEmeralds = useCallback((amount: number) => {
        setState(prev => ({
            ...prev,
            emeralds: prev.emeralds + amount,
            xp: prev.xp + (amount * 5),
            level: Math.floor((prev.xp + amount * 5) / 100) + 1
        }));
    }, []);

    const completeGame = useCallback((result: TestResult) => {
        setLastGameResult(result);
        
        setState(prev => {
            const newState = { ...prev };
            const type = result.gameType;

            if (isTestMode) {
                const currentBest = prev.testScores[type] || 0;
                if (result.score >= currentBest) {
                    newState.testScores = { ...prev.testScores, [type]: result.score };
                }
            } else {
                const newCounts = { ...prev.successCounts };
                newCounts[type] = (newCounts[type] || 0) + 1;
                const newLocks = { ...prev.isLocked };
                if (newCounts[type] >= 5) newLocks[type] = true;

                const newUnlockCounters = { ...prev.otherSuccessesSinceLock };
                Object.keys(newLocks).forEach(gameKey => {
                    if (newLocks[gameKey] && gameKey !== type) {
                        newUnlockCounters[gameKey] = (newUnlockCounters[gameKey] || 0) + 1;
                        if (newUnlockCounters[gameKey] >= 3) {
                            newLocks[gameKey] = false;
                            newCounts[gameKey] = 0;
                            newUnlockCounters[gameKey] = 0;
                        }
                    }
                });

                newState.successCounts = newCounts;
                newState.isLocked = newLocks;
                newState.otherSuccessesSinceLock = newUnlockCounters;
            }
            return newState;
        });

        addEmeralds(Math.floor(result.score / 10));
        setCurrentView('results');
    }, [isTestMode, addEmeralds]);

    const startGame = (type: GameType, mode: PlayMode = PlayMode.TIMED, test: boolean = false) => {
        if (!test && state.isLocked[type]) return;
        setActiveGame(type);
        setPlayMode(mode);
        setIsTestMode(test);
        setCurrentView('game');
    };

    const resetProgress = () => {
        if (confirm("Reset everything for Idris?")) {
            setState(INITIAL_STATE);
            setSettings(INITIAL_SETTINGS);
            setCurrentView('hub');
        }
    };

    const buyItem = (price: number, itemId: string) => {
        if (state.emeralds >= price && !state.unlockedItems.includes(itemId)) {
            setState(prev => ({
                ...prev,
                emeralds: prev.emeralds - price,
                unlockedItems: [...prev.unlockedItems, itemId],
                equippedItem: itemId
            }));
        } else if (state.unlockedItems.includes(itemId)) {
            setState(prev => ({ ...prev, equippedItem: itemId }));
        }
    };

    const renderContent = () => {
        switch (currentView) {
            case 'hub':
                return <Hub onStartGame={startGame} onOpenShop={() => setCurrentView('shop')} onOpenTests={() => setCurrentView('test-select')} lockedGames={state.isLocked} />;
            case 'test-select':
                return <TestSelection 
                    onStartTest={(type) => startGame(type, PlayMode.TIMED, true)} 
                    onBack={() => setCurrentView('hub')} 
                    scores={state.testScores}
                    hasDiamondSword={(Object.values(state.testScores) as number[]).every(s => s >= 90) && Object.keys(state.testScores).length >= 4}
                />;
            case 'game':
                return activeGame ? (
                    <GameScreen 
                        type={activeGame} 
                        mode={playMode}
                        isTest={isTestMode} 
                        settings={settings}
                        onComplete={completeGame}
                        onQuit={() => setCurrentView('hub')}
                    />
                ) : null;
            case 'results':
                return lastGameResult ? (
                    <ResultsScreen 
                        result={lastGameResult} 
                        isTest={isTestMode} 
                        onHome={() => setCurrentView('hub')} 
                        onRetry={() => startGame(activeGame!, playMode, isTestMode)}
                        isLocked={!isTestMode && !!state.isLocked[activeGame!]}
                    />
                ) : null;
            case 'shop':
                return <ShopScreen 
                    emeralds={state.emeralds} 
                    unlockedItems={state.unlockedItems} 
                    equippedItem={state.equippedItem} 
                    onBuy={buyItem} 
                    onBack={() => setCurrentView('hub')} 
                />;
            case 'parent':
                return <ParentPanel 
                    settings={settings} 
                    onUpdate={setSettings} 
                    onReset={resetProgress} 
                    onBack={() => setCurrentView('hub')} 
                />;
            default:
                return null;
        }
    };

    return (
        <div className="h-full w-full flex flex-col overflow-hidden bg-sky-200">
            {currentView !== 'game' && <HUD state={state} onOpenParent={() => setCurrentView('parent')} onHome={() => setCurrentView('hub')} showHome={currentView !== 'hub'} />}
            <main className="flex-1 overflow-hidden relative">
                {renderContent()}
            </main>
        </div>
    );
};

export default App;
