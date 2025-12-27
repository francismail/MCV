
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GameType, AppState, Settings, TestResult, MasteryRating, PlayMode } from '../types';
import { SHOP_ITEMS, MasteryColors, CRAFT_OBJECTS, INITIAL_STATE } from '../constants';
import { GoogleGenAI, Modality } from "@google/genai";

// Audio Helpers for Gemini TTS
function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

// Procedural Sound Effects using Web Audio API
const playSFX = (type: 'correct' | 'wrong' | 'victory') => {
    try {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        const now = ctx.currentTime;
        
        if (type === 'correct') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'wrong') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(100, now + 0.2);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
            osc.start(now);
            osc.stop(now + 0.4);
        } else if (type === 'victory') {
            osc.type = 'triangle';
            const notes = [523.25, 659.25, 783.99, 1046.50];
            notes.forEach((freq, i) => {
                const time = now + i * 0.1;
                osc.frequency.setValueAtTime(freq, time);
            });
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
            osc.start(now);
            osc.stop(now + 0.8);
        }
    } catch (e) {
        console.error("Audio failed", e);
    }
};

// Singleton to avoid creating multiple contexts and track active voice
let sharedAudioContext: AudioContext | null = null;
let activeAudioSource: AudioBufferSourceNode | null = null;
let currentSpeechToken = 0;

const stopCurrentAudio = () => {
    if (activeAudioSource) {
        try { activeAudioSource.stop(); } catch(e) {}
        activeAudioSource = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
};

const speak = async (text: string) => {
    const token = ++currentSpeechToken;
    
    // Immediate interruption
    stopCurrentAudio();

    // 1. AI High Quality TTS Attempt
    if (process.env.API_KEY) {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: `Say cheerfully to a 5-year-old child: ${text}` }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
                        },
                    },
                },
            });

            // If another speak request was made while we were generating, discard this one
            if (token !== currentSpeechToken) return;

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                if (!sharedAudioContext) {
                    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                }
                const audioData = decode(base64Audio);
                const audioBuffer = await decodeAudioData(audioData, sharedAudioContext, 24000, 1);
                
                // Final check before playing
                if (token !== currentSpeechToken) return;
                
                const source = sharedAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(sharedAudioContext.destination);
                activeAudioSource = source;
                source.start();
                return;
            }
        } catch (error) {
            console.warn("AI TTS failed, falling back to Web Speech API", error);
        }
    }

    // 2. Fallback to Native Browser TTS
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        // Re-check token in case AI call took long and then failed
        if (token !== currentSpeechToken) return;
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.2;
        utterance.volume = 1.0;
        utterance.lang = 'en-US';
        setTimeout(() => {
             if (token === currentSpeechToken) {
                window.speechSynthesis.speak(utterance);
             }
        }, 10);
    }
};

const SUCCESS_MESSAGES = [
    "Thumbs up Idris!", "Bravo Idris!", "Amazing Idris!", "Keep going Idris!", "So cool Idris!", "You're a star Idris!"
];

const WRONG_MESSAGES = [
    "Oops! Try again Idris!", "Almost there, Idris!", "You've got this, Idris!", "Keep trying, Idris!"
];

const FeedbackOverlay: React.FC<{ isVisible: boolean, isCorrect: boolean }> = ({ isVisible, isCorrect }) => {
    const lastIndex = useRef(-1);
    const [msg, setMsg] = useState("");

    useEffect(() => {
        if (isVisible) {
            const list = isCorrect ? SUCCESS_MESSAGES : WRONG_MESSAGES;
            let nextIndex = Math.floor(Math.random() * list.length);
            if (nextIndex === lastIndex.current) nextIndex = (nextIndex + 1) % list.length;
            lastIndex.current = nextIndex;
            
            const text = list[nextIndex];
            setMsg(text);
            speak(text);
        }
    }, [isVisible, isCorrect]);

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className={`
                ${isCorrect ? 'bg-green-500' : 'bg-orange-500'} 
                mc-block p-8 flex flex-col items-center gap-4 
                animate-bounce transform scale-125 shadow-2xl
            `}>
                <span className="text-8xl">{isCorrect ? '🌟' : '❌'}</span>
                <span className="pixel-font text-white text-xl text-center drop-shadow-md">{msg}</span>
            </div>
        </div>
    );
};

export const HUD: React.FC<{ state: AppState, onOpenParent: () => void, onHome: () => void, showHome: boolean, instruction?: string, subInstruction?: string }> = ({ state, onOpenParent, onHome, showHome, instruction, subInstruction }) => {
    return (
        <header className="bg-stone-900 text-white flex flex-col border-b-4 border-black safe-top">
            <div className="p-2 flex items-center justify-between h-24">
                <div className="flex items-center gap-4 min-w-[100px]">
                    {showHome ? (
                        <button onClick={onHome} className="mc-block mc-btn bg-stone-500 w-12 h-12 text-2xl text-white">🏠</button>
                    ) : (
                        <div className="flex gap-1 ml-2">
                             {[...Array(3)].map((_, i) => <span key={i} className="text-2xl">❤️</span>)}
                        </div>
                    )}
                </div>
                
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <h1 className="pixel-font text-xl text-white mb-1 uppercase tracking-widest leading-none drop-shadow-md">{instruction}</h1>
                    {subInstruction && <p className="text-[10px] pixel-font text-yellow-400 animate-pulse">{subInstruction}</p>}
                </div>

                <div className="flex items-center gap-4 min-w-[100px] justify-end">
                    <div className="flex items-center gap-1 bg-black/50 px-3 py-1 rounded-lg mc-block">
                        <span className="text-xl">🟩</span>
                        <span className="pixel-font text-sm text-white">{state.emeralds}</span>
                    </div>
                    <button onClick={onOpenParent} className="mc-block mc-btn bg-stone-500 w-12 h-12 text-2xl text-white">⚙️</button>
                </div>
            </div>
        </header>
    );
};

export const Hub: React.FC<{ onStartGame: (t: GameType, m: PlayMode) => void, onOpenShop: () => void, onOpenTests: () => void, lockedGames: Record<string, boolean> }> = ({ onStartGame, onOpenShop, onOpenTests, lockedGames }) => {
    const [mode, setMode] = useState<PlayMode>(PlayMode.TIMED);
    const tiles = [
        { type: GameType.MAKE_TEN, title: 'Craft 10', icon: '⚒️', color: 'bg-orange-700' },
        { type: GameType.NUMBER_HOP, title: 'Bridge', icon: '🌉', color: 'bg-blue-600' },
        { type: GameType.DOUBLES, title: 'Magic x2', icon: '🪄', color: 'bg-purple-600' },
        { type: GameType.COUNT_UP, title: 'Rescue', icon: '🆘', color: 'bg-red-600' },
    ];

    return (
        <div className="flex flex-col h-full p-4 overflow-y-auto gap-4">
            <div className="flex gap-2 justify-center mb-2">
                {[PlayMode.TIMED, PlayMode.FREE, PlayMode.STREAK].map(m => (
                    <button 
                        key={m} 
                        onClick={() => setMode(m)}
                        className={`flex-1 mc-block p-2 pixel-font text-[8px] h-14 ${mode === m ? 'bg-yellow-400 text-stone-900 border-white' : 'bg-stone-700 text-white'}`}
                    >
                        {m === PlayMode.STREAK ? '🚂 20 Streak' : m}
                    </button>
                ))}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {tiles.map(tile => {
                    const isLocked = !!lockedGames[tile.type];
                    return (
                        <button 
                            key={tile.type} 
                            disabled={isLocked}
                            onClick={() => onStartGame(tile.type, mode)}
                            className={`${isLocked ? 'bg-stone-400 grayscale cursor-not-allowed opacity-60' : tile.color} mc-block mc-btn flex-col gap-2 text-white h-44 relative`}
                        >
                            {isLocked && <div className="absolute top-2 left-2 right-2 bg-yellow-400 text-stone-900 pixel-font text-[8px] p-1 mc-block">RESTING...</div>}
                            <span className="text-5xl">{isLocked ? '😴' : tile.icon}</span>
                            <span className="pixel-font text-[10px] text-center uppercase leading-none">{isLocked ? 'Try Others!' : tile.title}</span>
                        </button>
                    );
                })}
                <button onClick={onOpenTests} className="bg-stone-700 mc-block mc-btn flex-col gap-2 text-white h-44">
                    <span className="text-5xl">⚔️</span>
                    <span className="pixel-font text-xs uppercase">Training</span>
                </button>
                <button onClick={onOpenShop} className="bg-green-700 mc-block mc-btn flex-col gap-2 text-white h-44">
                    <span className="text-5xl">📦</span>
                    <span className="pixel-font text-xs uppercase">Chest</span>
                </button>
            </div>
        </div>
    );
};

export const TestSelection: React.FC<{ onStartTest: (t: GameType) => void, onBack: () => void, scores: Record<string, number>, hasDiamondSword: boolean }> = ({ onStartTest, onBack, scores, hasDiamondSword }) => {
    const tests = [
        { type: GameType.MAKE_TEN, title: 'Bonds to 10', icon: '🧱' },
        { type: GameType.DOUBLES, title: 'Double Power', icon: '🌟' },
        { type: GameType.NUMBER_HOP, title: 'Bridge Test', icon: '🏔️' },
        { type: GameType.COUNT_UP, title: 'Count Up', icon: '🏃' },
    ];
    return (
        <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto bg-stone-300">
            <h2 className="pixel-font text-lg text-stone-900 mb-2">Mastery Tests</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tests.map(t => {
                    const score = scores[t.type] || 0;
                    const rating = score >= 90 ? 'Diamond' : score >= 75 ? 'Iron' : 'Wood';
                    return (
                        <div key={t.type} className="bg-stone-100 p-4 mc-block flex items-center justify-between">
                            <div className="flex items-center gap-3 text-stone-900">
                                <span className="text-4xl">{t.icon}</span>
                                <div><p className="font-bold text-sm uppercase">{t.title}</p><p className={`text-xs pixel-font ${MasteryColors[rating]}`}>{rating} ({score}%)</p></div>
                            </div>
                            <button onClick={() => onStartTest(t.type)} className="bg-stone-800 text-white px-6 py-3 mc-block text-xs uppercase">Start</button>
                        </div>
                    );
                })}
            </div>
            <button onClick={onBack} className="mt-auto mc-btn mc-block bg-stone-500 text-white w-full uppercase">Back</button>
        </div>
    );
};

const GameLogic: React.FC<{ 
    type: GameType, 
    settings: Settings, 
    onAnswer: (correct: boolean) => void,
    onSetInstructions: (main: string, sub: string) => void,
    feedbackVisible: boolean
}> = ({ type, settings, onAnswer, onSetInstructions, feedbackVisible }) => {
    const [question, setQuestion] = useState<any>(null);
    const [userInput, setUserInput] = useState<any>(null);
    const [hopsLeft, setHopsLeft] = useState(0);
    const [shake, setShake] = useState(false);
    const [currentIcon, setCurrentIcon] = useState(CRAFT_OBJECTS[0]);
    const [choices, setChoices] = useState<number[]>([]);
    const [showLocalTen, setShowLocalTen] = useState(false);

    const generateQuestion = useCallback(() => {
        const range = settings.range;
        const opMode = settings.ops;
        setCurrentIcon(CRAFT_OBJECTS[Math.floor(Math.random() * CRAFT_OBJECTS.length)]);
        setShowLocalTen(false);
        
        switch (type) {
            case GameType.MAKE_TEN: {
                const have = Math.floor(Math.random() * 8) + 1;
                const need = 10 - have;
                const finalChoices = Array.from(new Set([need, Math.max(0, need + 1), Math.max(0, need - 1)]));
                while(finalChoices.length < 3) {
                    const extra = Math.floor(Math.random() * 11);
                    if (!finalChoices.includes(extra)) finalChoices.push(extra);
                }
                setQuestion({ have, need });
                setUserInput(have);
                setChoices(finalChoices.sort(() => Math.random() - 0.5));
                onSetInstructions("Craft 10!", `Have: ${have}. How many more?`);
                speak(`Craft 10! You have ${have}. Add more blocks to make 10.`);
                break;
            }
            case GameType.DOUBLES: {
                const d = Math.floor(Math.random() * (range / 2)) + 1;
                const near = opMode === 'mixed' && Math.random() > 0.6 ? (Math.random() > 0.5 ? 1 : -1) : 0;
                const ans = d + d + near;
                setQuestion({ a: d, b: d + near, ans });
                
                const choiceList = Array.from(new Set([ans, ans + 1, Math.max(0, ans - 1)]));
                while(choiceList.length < 3) {
                    const extra = Math.floor(Math.random() * (range + 1));
                    if (!choiceList.includes(extra)) choiceList.push(extra);
                }
                setChoices(choiceList.sort(() => Math.random() - 0.5));

                onSetInstructions("Double it!", `Double ${d}!`);
                speak(`Double it! What is ${d} plus ${d + near}?`);
                break;
            }
            case GameType.NUMBER_HOP: {
                const isSub = opMode === 'mixed' ? Math.random() > 0.5 : opMode === 'minus';
                let start, jump, target;
                if (!isSub) {
                    start = Math.floor(Math.random() * (range - 3));
                    jump = Math.floor(Math.random() * (range - start - 1)) + 1;
                    target = start + jump;
                } else {
                    start = Math.floor(Math.random() * (range - 3)) + 3;
                    jump = Math.floor(Math.random() * start) + 1;
                    target = start - jump;
                }
                setQuestion({ start, jump, target, isSub });
                setUserInput(start);
                setHopsLeft(jump);
                const instr = isSub ? `Start at ${start}. Hop back ${jump}.` : `Start at ${start}. Hop ${jump}.`;
                onSetInstructions(`${start} ${isSub ? '−' : '+'} ${jump} = ?`, instr);
                speak(instr);
                break;
            }
            case GameType.COUNT_UP: {
                const end = Math.floor(Math.random() * 8) + (range === 10 ? 3 : 12);
                const base = Math.max(0, end - (Math.floor(Math.random() * 5) + 2));
                setQuestion({ start: base, end: end, ans: end - base });
                setUserInput(base);
                onSetInstructions(`${end} − ${base} = ?`, `Count up from ${base} to ${end}!`);
                speak(`Rescue mission! To solve ${end} minus ${base}, let's count up from ${base} until we reach ${end}.`);
                break;
            }
        }
    }, [type, settings.range, settings.ops, onSetInstructions]);

    useEffect(() => {
        generateQuestion();
    }, [generateQuestion]);

    const handleChoice = (val: number) => {
        if (type === GameType.MAKE_TEN) {
            if (val === question.need) {
                setUserInput(10);
                setShowLocalTen(true);
                onAnswer(true);
                setTimeout(generateQuestion, 2000);
            } else {
                setShake(true);
                setTimeout(() => setShake(false), 500);
                onAnswer(false);
            }
            return;
        }
        if (val === question.ans) {
            onAnswer(true);
            setTimeout(generateQuestion, 2000);
        } else {
            setShake(true);
            setTimeout(() => setShake(false), 500);
            onAnswer(false);
        }
    };

    const handleHop = (jumpVal: number) => {
        const actualJump = question.isSub ? -jumpVal : jumpVal;
        if (hopsLeft < jumpVal) return;
        
        const nextPos = userInput + actualJump;
        setUserInput(nextPos);
        setHopsLeft(prev => prev - jumpVal);
        
        if (hopsLeft - jumpVal === 0) {
            if (nextPos === question.target) {
                onAnswer(true);
                setTimeout(generateQuestion, 2000);
            } else {
                setShake(true);
                setTimeout(() => {
                    setShake(false);
                    setUserInput(question.start);
                    setHopsLeft(question.jump);
                }, 500);
                onAnswer(false);
            }
        }
    };

    const handleRescueHop = (jumpVal: number) => {
        const nextPos = userInput + jumpVal;
        if (nextPos === question.end) {
            setUserInput(nextPos);
            speak(`${nextPos}! Perfect!`);
            onAnswer(true);
            setTimeout(generateQuestion, 2000);
        } else if (nextPos > question.end) {
            setShake(true);
            setTimeout(() => setShake(false), 500);
            onAnswer(false);
        } else {
            setUserInput(nextPos);
            speak(nextPos.toString());
        }
    };

    if (!question) return null;

    return (
        <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-4 ${shake ? 'shake' : ''} overflow-hidden`}>
            {type === GameType.MAKE_TEN && (
                <div className="flex flex-col items-center gap-4 w-full h-full justify-center">
                    <div className="mb-6">
                        <h2 className="pixel-font text-5xl text-blue-600 drop-shadow-[4px_4px_0px_rgba(0,0,0,0.2)] text-center animate-pulse uppercase">MAKE 10!</h2>
                    </div>

                    <div className="h-32 flex items-center justify-center relative w-full mb-4">
                        {showLocalTen && (
                            <div className="absolute animate-bounce flex flex-col items-center">
                                <span className="text-8xl pixel-font text-yellow-500 drop-shadow-xl z-10">10!</span>
                                <div className="text-xl pixel-font text-stone-800 bg-white/80 px-4 py-1 rounded-full mc-block mt-2">Perfect Idris!</div>
                            </div>
                        )}
                        {!showLocalTen && (
                            <div className={`text-stone-800 pixel-font text-[10px] flex flex-col items-center bg-white/70 p-6 mc-block border-stone-900 shadow-xl ${feedbackVisible ? 'opacity-0' : 'opacity-100'}`}>
                                <span className="mb-2 uppercase">You have {question.have} blocks.</span>
                                <span className="text-blue-700 font-black uppercase">How many more blocks to make 10?</span>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-5 gap-3 mc-block bg-stone-800 p-6 shadow-2xl scale-110">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className={`w-14 h-14 mc-block flex items-center justify-center ${i < userInput ? 'bg-orange-500' : 'bg-stone-700'}`}>
                                {i < userInput && <span className="text-4xl animate-pulse">{currentIcon}</span>}
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-6 mt-12">
                        {choices.map((c, i) => (
                            <button key={i} onClick={() => handleChoice(c)} className="w-24 h-24 bg-white mc-block text-4xl font-bold text-stone-900 shadow-xl active:scale-90 active:translate-y-1 transition-all">{c}</button>
                        ))}
                    </div>
                </div>
            )}

            {type === GameType.DOUBLES && (
                <div className="flex flex-col items-center justify-center w-full h-full">
                    <div className="flex flex-col items-center justify-center w-full max-w-4xl py-12">
                        <div className={`flex flex-col items-center mb-10 transition-opacity duration-200 ${feedbackVisible ? 'opacity-0' : 'opacity-100'}`}>
                            <span className="pixel-font text-4xl text-blue-700 uppercase tracking-tighter drop-shadow-sm">Double it!</span>
                            <span className="pixel-font text-sm text-stone-600 mt-3 font-bold uppercase tracking-widest">Double {question.a}</span>
                        </div>
                        
                        <div className="text-[120px] font-black flex gap-10 pixel-font text-stone-900 drop-shadow-lg mb-12 leading-none">
                            <span>{question.a}</span><span>+</span><span>{question.b}</span>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-10 w-full px-8">
                            {choices.map((v, i) => (
                                <button 
                                    key={i} 
                                    onClick={() => handleChoice(v)} 
                                    className="bg-white mc-block py-14 text-7xl font-black text-stone-900 shadow-[0_20px_40px_rgba(0,0,0,0.15)] active:translate-y-3 active:shadow-inner transition-all hover:bg-stone-50"
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {type === GameType.NUMBER_HOP && (
                <div className="flex flex-col items-center w-full gap-4 justify-center h-full">
                    <div className={`flex flex-col items-center mb-8 transition-opacity duration-200 ${feedbackVisible ? 'opacity-0' : 'opacity-100'}`}>
                        <h2 className="pixel-font text-4xl text-blue-600 drop-shadow-[2px_2px_0px_rgba(0,0,0,0.2)] text-center mb-4">
                            {question.start} {question.isSub ? '−' : '+'} {question.jump} = ?
                        </h2>
                        <div className="bg-white/70 px-6 py-4 mc-block border-stone-800 text-center shadow-lg">
                            <p className="pixel-font text-[10px] uppercase text-stone-900 font-black mb-2">
                                Start at {question.start}. {question.isSub ? 'Hop back' : 'Hop'} {question.jump} blocks.
                            </p>
                            <p className="pixel-font text-[12px] uppercase text-red-600 font-black animate-pulse">
                                Hops Left: {hopsLeft}
                            </p>
                        </div>
                    </div>

                    <div className="w-full h-52 relative mc-block bg-stone-200 flex items-center px-4 overflow-hidden shadow-inner mb-6">
                         <div className="flex items-center gap-0 w-full relative h-full">
                            {[...Array(settings.range + 1)].map((_, i) => (
                                <div key={i} className={`flex-1 h-14 border-r border-stone-400 flex items-center justify-center relative`}>
                                    <span className={`text-[10px] absolute -bottom-10 font-bold ${i % 10 === 0 ? 'text-blue-800 scale-150 underline' : 'text-stone-700'} w-full text-center`}>{i}</span>
                                    {userInput === i && (
                                        <div className="absolute -top-20 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center transition-all duration-300 pointer-events-none">
                                            <div className="w-20 h-20 rounded-full bg-blue-500/20 absolute -z-10 animate-ping"></div>
                                            <span className="text-7xl drop-shadow-[0_5px_5px_rgba(0,0,0,0.5)]">🕷️</span>
                                            <span className="text-[8px] pixel-font text-blue-900 mt-1 uppercase font-black whitespace-nowrap">IDRIS</span>
                                        </div>
                                    )}
                                    {question.target === i && (
                                        <div className="absolute -top-14 left-1/2 -translate-x-1/2 opacity-90 z-10 animate-pulse flex flex-col items-center pointer-events-none">
                                            <span className="text-5xl drop-shadow-md">🚩</span>
                                            <div className="w-12 h-1 bg-red-600/30 blur-sm rounded-full mt-1"></div>
                                        </div>
                                    )}
                                </div>
                            ))}
                         </div>
                    </div>
                    <div className="flex gap-6 w-full px-6 game-controls max-w-2xl mt-4">
                        {[1, 2, 5].map(v => (
                            <button 
                                key={v} 
                                disabled={hopsLeft < v} 
                                onClick={() => handleHop(v)} 
                                className={`flex-1 mc-block p-8 text-4xl font-black transition-all ${hopsLeft >= v ? 'bg-blue-600 text-white shadow-2xl active:translate-y-2' : 'bg-stone-300 text-stone-500 opacity-40 shadow-none'}`}
                            >
                                {question.isSub ? '−' : '+'}{v}
                            </button>
                        ))}
                        <button onClick={() => { setUserInput(question.start); setHopsLeft(question.jump); }} className="w-24 bg-red-500 text-white mc-block p-6 text-2xl active:scale-90">🔄</button>
                    </div>
                </div>
            )}

            {type === GameType.COUNT_UP && (
                <div className="flex flex-col items-center gap-6 justify-center h-full w-full">
                    {/* Centered Large Equation Header */}
                    <div className={`flex flex-col items-center mb-8 transition-opacity duration-200 ${feedbackVisible ? 'opacity-0' : 'opacity-100'}`}>
                        <h2 className="pixel-font text-5xl text-blue-600 drop-shadow-[3px_3px_0px_rgba(0,0,0,0.2)] text-center mb-6 uppercase">
                            Rescue Mission!
                        </h2>
                        <div className="text-[80px] font-black pixel-font text-stone-900 mb-6 flex gap-6 items-center">
                            <span>{question.end}</span>
                            <span className="text-red-600 relative -top-[0.1em]">−</span>
                            <span>{question.start}</span>
                            <span className="text-blue-700">=</span>
                            <span className="animate-pulse">?</span>
                        </div>
                        <div className="bg-white/80 p-6 mc-block border-stone-800 text-center shadow-xl max-w-lg">
                            <p className="pixel-font text-[10px] uppercase text-stone-900 font-black leading-relaxed">
                                Let's count from {question.start} up to {question.end}!
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-10 text-7xl text-stone-900 font-bold bg-white/70 p-16 mc-block shadow-2xl border-stone-400">
                        <div className="flex flex-col items-center"><span className="text-4xl mb-2">🚩</span><span>{userInput}</span></div>
                        <span className="text-5xl animate-pulse">➡️</span>
                        <div className="flex flex-col items-center opacity-40"><span className="text-4xl mb-2">🏁</span><span>{question.end}</span></div>
                    </div>

                    <div className="flex gap-8 w-full px-4 max-w-xl mt-8">
                        {[1, 2].map(v => (
                            <button key={v} onClick={() => handleRescueHop(v)} className="flex-1 bg-green-600 text-white mc-block p-10 text-5xl font-black shadow-2xl active:scale-95 active:bg-green-700">+{v}</button>
                        ))}
                        <button onClick={() => setUserInput(question.start)} className="w-28 bg-red-500 text-white mc-block p-4 active:rotate-180 transition-transform">🔄</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export const GameScreen: React.FC<{ 
    type: GameType, 
    mode: PlayMode,
    isTest: boolean, 
    settings: Settings, 
    onComplete: (r: TestResult) => void, 
    onQuit: () => void 
}> = ({ type, mode, isTest, settings, onComplete, onQuit }) => {
    const [qIndex, setQIndex] = useState(0);
    const [correctCount, setCorrectCount] = useState(0);
    const [hearts, setHearts] = useState(mode === PlayMode.STREAK ? 3 : 99);
    const [timeLeft, setTimeLeft] = useState(isTest ? settings.testTimer : settings.sessionTimer * 60);
    const [feedback, setFeedback] = useState<{ visible: boolean, correct: boolean }>({ visible: false, correct: false });
    const [instructions, setInstructions] = useState({ main: "", sub: "" });
    const timerRef = useRef<any>(null);

    useEffect(() => {
        if (!isTest && mode === PlayMode.TIMED) {
            timerRef.current = setInterval(() => setTimeLeft(prev => prev > 0 ? prev - 1 : 0), 1000);
        } else if (isTest) {
            timerRef.current = setInterval(() => setTimeLeft(prev => prev > 0 ? prev - 1 : 0), 1000);
        }
        return () => clearInterval(timerRef.current);
    }, [mode, isTest]);

    const memoOnSetInstructions = useCallback((main: string, sub: string) => {
        setInstructions({ main, sub });
    }, []);

    const handleAnswer = (correct: boolean) => {
        setFeedback({ visible: true, correct });
        
        if (settings.soundOn) {
            playSFX(correct ? 'correct' : 'wrong');
        }

        setTimeout(() => setFeedback({ visible: false, correct: false }), 1500);

        if (correct) {
            const nextCorrect = correctCount + 1;
            setCorrectCount(nextCorrect);
            
            const isFinished = (isTest && qIndex + 1 >= 10) || (mode === PlayMode.STREAK && nextCorrect >= 20);
            
            if (isFinished) {
                if (settings.soundOn) playSFX('victory');
                const finalResult = isTest 
                    ? { score: (nextCorrect/10)*100, rating: (nextCorrect/10)*100 >= 90 ? 'Diamond' : 'Wood', time: settings.testTimer - timeLeft, gameType: type } as TestResult
                    : { score: 100, rating: 'Diamond', time: 0, gameType: type } as TestResult;
                
                setTimeout(() => onComplete(finalResult), 2000);
            } else {
                setQIndex(prev => prev + 1);
            }
        } else {
            if (mode === PlayMode.STREAK) {
                setHearts(prev => {
                    if (prev <= 1) setTimeout(onQuit, 1600);
                    return prev - 1;
                });
            }
        }
    };

    return (
        <div className="flex flex-col h-full bg-sky-100 relative overflow-hidden">
            <FeedbackOverlay isVisible={feedback.visible} isCorrect={feedback.correct} />
            <HUD state={INITIAL_STATE} onOpenParent={() => {}} onHome={onQuit} showHome={true} instruction={instructions.main} subInstruction={instructions.sub} />
            
            <div className="px-6 py-3 flex justify-between items-center bg-stone-100 border-b-4 border-stone-800">
                <div className="flex gap-3">
                    {mode === PlayMode.STREAK && [...Array(3)].map((_, i) => (
                        <span key={i} className={`text-3xl transition-all duration-500 ${i < hearts ? 'scale-125' : 'grayscale opacity-10 blur-[1px]'}`}>❤️</span>
                    ))}
                    {!isTest && mode !== PlayMode.STREAK && <span className={`pixel-font text-xs text-stone-500 uppercase tracking-tighter transition-opacity duration-200 ${feedback.visible ? 'opacity-0' : 'opacity-100'}`}>FREE PLAY MODE</span>}
                </div>
                <div className="pixel-font text-sm text-stone-900 font-black">
                    {mode === PlayMode.STREAK ? `STREAK: ${correctCount}/20` : `IDRIS SCORE: ${correctCount}`}
                </div>
                {(mode === PlayMode.TIMED || isTest) && <div className="pixel-font text-sm text-red-700 font-bold border-2 border-red-700 px-2 py-1 bg-red-100">⏱️ {timeLeft}S</div>}
            </div>
            
            <GameLogic type={type} settings={settings} onAnswer={handleAnswer} onSetInstructions={memoOnSetInstructions} feedbackVisible={feedback.visible} />

            <div className="p-4 safe-bottom flex gap-2">
                <button onClick={onQuit} className="bg-stone-500 text-white mc-block mc-btn flex-1 uppercase text-sm tracking-widest font-bold">Back to Hub</button>
            </div>
        </div>
    );
};

export const ResultsScreen: React.FC<{ result: TestResult, isTest: boolean, onHome: () => void, onRetry: () => void, isLocked: boolean }> = ({ result, isTest, onHome, onRetry, isLocked }) => {
    return (
        <div className="h-full flex flex-col items-center justify-center p-8 bg-stone-300 mc-grid-bg">
            <div className="bg-white mc-block p-12 w-full max-w-md flex flex-col items-center gap-8 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                <h2 className="pixel-font text-3xl text-stone-900 uppercase text-center">{isTest ? 'Trial Report' : 'HERO IDRIS!'}</h2>
                <div className="text-[140px] mb-4 floating drop-shadow-2xl">{result.rating === 'Diamond' ? '💎' : '🪵'}</div>
                <div className="text-center">
                    <p className={`pixel-font text-3xl ${MasteryColors[result.rating]}`}>{result.rating} Mastery</p>
                    <p className="text-stone-700 font-black mt-4 text-2xl">Accuracy: {result.score}%</p>
                </div>
                <div className="flex flex-col gap-4 w-full">
                    {!isLocked && <button onClick={onRetry} className="bg-green-600 text-white mc-block mc-btn uppercase text-lg shadow-lg active:translate-y-1">Play Again</button>}
                    <button onClick={onHome} className="bg-stone-500 text-white mc-block mc-btn uppercase text-lg shadow-lg active:translate-y-1">Return Hub</button>
                </div>
            </div>
        </div>
    );
};

export const ShopScreen: React.FC<{ emeralds: number, unlockedItems: string[], equippedItem: string, onBuy: (p: number, i: string) => void, onBack: () => void }> = ({ emeralds, unlockedItems, equippedItem, onBuy, onBack }) => {
    return (
        <div className="h-full flex flex-col p-4 bg-stone-300 overflow-hidden">
            <h2 className="pixel-font text-2xl mb-8 text-stone-900 text-center uppercase tracking-widest border-b-4 border-stone-400 pb-4">VILLAGE CHEST</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 overflow-y-auto mb-6 p-4">
                {SHOP_ITEMS.map(item => (
                    <button key={item.id} onClick={() => onBuy(item.price, item.id)} className={`mc-block p-8 flex flex-col items-center gap-4 transition-all active:scale-95 ${equippedItem === item.id ? 'bg-yellow-200 border-yellow-600 scale-105 shadow-xl' : 'bg-stone-50 shadow-md'}`}>
                        <span className="text-6xl">{item.icon}</span>
                        <span className="text-sm font-black text-stone-900 uppercase">{item.name}</span>
                        <div className="bg-black/10 px-4 py-2 mc-block w-full text-center">
                            <span className="text-xs pixel-font text-green-700">{unlockedItems.includes(item.id) ? (equippedItem === item.id ? 'EQUIPPED' : 'USE NOW') : `${item.price} 🟩`}</span>
                        </div>
                    </button>
                ))}
            </div>
            <button onClick={onBack} className="mt-auto mc-btn mc-block bg-stone-800 text-white uppercase text-2xl h-24 tracking-widest font-black">Close Shop</button>
        </div>
    );
};

export const ParentPanel: React.FC<{ settings: Settings, onUpdate: (s: Settings) => void, onReset: () => void, onBack: () => void }> = ({ settings, onUpdate, onReset, onBack }) => {
    const update = (key: keyof Settings, val: any) => onUpdate({ ...settings, [key]: val });
    return (
        <div className="h-full flex flex-col p-8 bg-stone-100 overflow-y-auto">
            <h2 className="pixel-font text-2xl mb-10 text-stone-900 text-center uppercase border-b-4 border-stone-800 pb-6 tracking-tight">PARENT CONTROLS</h2>
            <div className="flex flex-col gap-12 max-w-2xl mx-auto w-full">
                <section>
                    <p className="font-black text-lg uppercase text-stone-700 mb-4 border-l-8 border-orange-500 pl-4">Difficulty Level</p>
                    <div className="flex gap-6">
                        {[10, 20].map(v => <button key={v} onClick={() => update('range', v)} className={`flex-1 p-8 mc-block font-black text-3xl shadow-lg ${settings.range === v ? 'bg-stone-900 text-white' : 'bg-white text-stone-900'}`}>0 - {v}</button>)}
                    </div>
                </section>
                <section>
                    <p className="font-black text-lg uppercase text-stone-700 mb-4 border-l-8 border-blue-500 pl-4">Math Skills</p>
                    <div className="flex gap-6">
                        {['plus', 'mixed'].map(o => <button key={o} onClick={() => update('ops', o)} className={`flex-1 p-8 mc-block text-lg font-black uppercase shadow-lg ${settings.ops === o ? 'bg-stone-900 text-white' : 'bg-white text-stone-900'}`}>{o === 'plus' ? 'Addition Only' : 'Mixed (+ / −)'}</button>)}
                    </div>
                </section>
                <section>
                    <p className="font-black text-lg uppercase text-stone-700 mb-4 border-l-8 border-purple-500 pl-4">Timer Speed</p>
                    <div className="flex gap-6">
                        {[30, 60, 90].map(t => <button key={t} onClick={() => update('testTimer', t)} className={`flex-1 p-8 mc-block font-black text-2xl shadow-lg ${settings.testTimer === t ? 'bg-stone-900 text-white' : 'bg-white text-stone-900'}`}>{t}s</button>)}
                    </div>
                </section>
                <div className="flex flex-col gap-6 mt-12 pt-12 border-t-4 border-stone-300">
                    <button onClick={onReset} className="bg-red-700 text-white mc-block mc-btn text-sm font-black uppercase tracking-[0.2em] py-8 shadow-xl">ERASE PROGRESS</button>
                    <button onClick={onBack} className="bg-stone-900 text-white mc-block mc-btn uppercase text-2xl py-8 tracking-widest font-black shadow-xl">SAVE & EXIT</button>
                </div>
            </div>
        </div>
    );
};
