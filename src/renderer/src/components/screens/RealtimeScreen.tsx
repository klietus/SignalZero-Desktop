import React, { useState, useEffect, useRef } from 'react';
import { Camera, Monitor, Mic, MicOff, Loader2, Activity, Volume2, ShieldAlert, Cpu, Zap, ZapOff, Clock, User, Mic2, Bell, VolumeX, AudioLines, BrainCircuit, Heart, Smile, Frown, Angry, Annoyed } from 'lucide-react';
import { Header, HeaderProps } from '../Header';

interface TranscriptEntry {
    speaker: string;
    text: string;
    emotion: string;
    timestamp: number;
}

interface AudioStreamState {
    lastSpeaker: string | null;
    recognitionConfidence: number;
    isSpeaking: boolean;
    rmsLevel: number;
    runningTranscript: string;
    transcript: TranscriptEntry[];
    vocalEmotion: string;
    status: { isActive: boolean; isError: boolean; errorMessage?: string };
}

interface PersonDetection {
    id: string;
    expression: string;
    attributes: Record<string, any>;
    bbox: [number, number, number, number];
}

interface CameraStreamState {
    lastFrame: string | null;
    people: PersonDetection[];
    timestamp: number;
    status: { isActive: boolean; isError: boolean; errorMessage?: string };
}

interface ScreenStreamState {
    lastFrame: string | null;
    activeApplication: string | null;
    timestamp: number;
    status: { isActive: boolean; isError: boolean; errorMessage?: string };
}

interface AutonomousState {
    lastSpikeReason: string | null;
    isProcessingFlashRound: boolean;
    recentSpikeTimeline: { timestamp: number, reason: string }[];
}

interface SceneState {
    audio: AudioStreamState;
    camera: CameraStreamState;
    screen: ScreenStreamState;
    autonomous: AutonomousState;
}

interface RealtimeScreenProps {
    headerProps: HeaderProps;
}

const EMOTION_CONFIG: Record<string, { color: string, icon: any }> = {
    'neutral': { color: 'text-gray-400', icon: Activity },
    'happiness': { color: 'text-emerald-400', icon: Smile },
    'sadness': { color: 'text-blue-400', icon: Frown },
    'anger': { color: 'text-rose-500', icon: Angry },
    'fear': { color: 'text-purple-400', icon: ShieldAlert },
    'surprise': { color: 'text-amber-400', icon: Zap },
    'disgust': { color: 'text-orange-400', icon: Annoyed },
    'contempt': { color: 'text-pink-400', icon: Heart }
};

export const RealtimeScreen: React.FC<RealtimeScreenProps> = ({ headerProps }) => {
    const [state, setState] = useState<SceneState | null>(null);
    const [isAutonomousEnabled, setIsAutonomousEnabled] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(false);
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Initial fetch
        window.api.getRealtimeState().then(setState);
        window.api.getSettings().then(s => {
            setIsAutonomousEnabled(!!s.realtimeAssistance?.enabled);
            setVoiceEnabled(!!s.voiceEnabled);
        });

        // Listen for full scene updates (high frequency)
        const unbind = window.api.onRealtimeUpdate((update) => {
            setState(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    [update.type]: update.state
                };
            });
        });

        return () => unbind();
    }, []);

    useEffect(() => {
        if (transcriptEndRef.current) {
            transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [state?.audio.runningTranscript]);

    const toggleCamera = () => {
        if (state?.camera.status.isActive) {
            window.api.stopRealtimeStream('camera');
        } else {
            window.api.startRealtimeStream('camera');
        }
    };

    const toggleScreen = () => {
        if (state?.screen.status.isActive) {
            window.api.stopRealtimeStream('screen');
        } else {
            window.api.startRealtimeStream('screen');
        }
    };

    const toggleVoice = async () => {
        if (state?.audio.status.isActive) {
            await window.api.toggleVoiceMode(false);
        } else {
            await window.api.toggleVoiceMode(true);
        }
    };

    const toggleAutonomous = async () => {
        const settings = await window.api.getSettings();
        const newState = !isAutonomousEnabled;
        await window.api.updateSettings({
            ...settings,
            realtimeAssistance: {
                ...settings.realtimeAssistance,
                enabled: newState
            }
        });
        setIsAutonomousEnabled(newState);
    };

    const toggleVoiceEnabled = async () => {
        const newState = !voiceEnabled;
        await window.api.toggleVoiceEnabled(newState);
        setVoiceEnabled(newState);
    };

    const cancelSpeech = () => {
        window.api.cancelSpeech();
    };

    if (!state) return (
        <div className="flex-1 flex flex-col min-h-0 bg-gray-950 items-center justify-center">
            <Loader2 className="animate-spin text-indigo-500" size={32} />
        </div>
    );

    const dominantEmotion = state.camera.people[0]?.expression || 'neutral';
    const emotionConfig = EMOTION_CONFIG[dominantEmotion] || EMOTION_CONFIG.neutral;
    const EmotionIcon = emotionConfig.icon;

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-950 overflow-hidden text-gray-100 font-sans">
            <Header {...headerProps} />
            
            {/* 1. TOP METRICS & CONTROLS BAR */}
            <div className="px-6 py-3 border-b border-gray-800 bg-gray-900/40 flex items-center justify-between shrink-0 h-16">
                <div className="flex items-center gap-6 h-full">
                    
                    {/* Vertical Intensity Bar */}
                    <div className="flex flex-col items-center justify-center h-full px-2 gap-1 border-r border-gray-800 pr-6">
                        <div className="flex-1 w-2.5 bg-gray-800 rounded-full relative overflow-hidden border border-white/5 shadow-inner">
                            <div 
                                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-indigo-600 to-indigo-400 transition-all duration-75 shadow-[0_0_8px_rgba(99,102,241,0.5)]" 
                                style={{ height: `${Math.min(100, state.audio.rmsLevel * 250)}%` }}
                            />
                        </div>
                        <p className="text-[7px] font-mono text-gray-500 uppercase tracking-tighter">Level</p>
                    </div>

                    {/* Vertical Emotion Bars */}
                    <div className="flex items-center gap-2 h-full border-r border-gray-800 pr-6">
                        {state.camera.people[0]?.attributes.emotion_scores && 
                            Object.entries(state.camera.people[0].attributes.emotion_scores)
                                .sort(([,a], [,b]) => (b as number) - (a as number))
                                .slice(0, 4)
                                .map(([emotion, score]) => (
                            <div key={emotion} className="flex flex-col items-center justify-end h-full w-4 gap-1">
                                <div className="flex-1 w-1.5 bg-gray-900 rounded-full relative overflow-hidden shadow-inner">
                                    <div 
                                        className={`absolute bottom-0 left-0 right-0 transition-all duration-500 ${emotion === state.camera.people[0].expression ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-gray-700'}`}
                                        style={{ height: `${(Number(score) || 0) * 100}%` }}
                                    />
                                </div>
                                <p className={`text-[6px] font-mono uppercase truncate w-full text-center ${emotion === state.camera.people[0].expression ? 'text-emerald-400 font-bold' : 'text-gray-600'}`}>{emotion.substring(0, 3)}</p>
                            </div>
                        ))}
                        {!state.camera.people[0] && (
                            <div className="flex items-center justify-center w-24 h-full opacity-10 italic text-[8px] font-mono">Sensors_Cold</div>
                        )}
                    </div>

                    {/* Dominant Emotion Callout */}
                    <div className="flex items-center gap-3 border-r border-gray-800 pr-6">
                         <div className={`p-1.5 rounded-full bg-gray-800 ${emotionConfig.color}`}>
                            <EmotionIcon size={14} />
                        </div>
                        <div>
                            <p className="text-[8px] font-mono text-gray-500 uppercase tracking-widest leading-none mb-1">Visual_Affect</p>
                            <p className={`text-[10px] font-mono font-bold leading-none uppercase ${emotionConfig.color}`}>
                                {dominantEmotion}
                            </p>
                        </div>
                    </div>

                    {/* AI Vocalization Status */}
                    <div className="flex items-center gap-3 border-r border-gray-800 pr-6">
                         <div className={`p-1.5 rounded-full ${state.audio.status.isActive && state.audio.lastSpeaker !== 'USER' && state.audio.isSpeaking ? 'bg-blue-500/20 text-blue-400 animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
                            <Mic2 size={14} />
                        </div>
                        <div>
                            <p className="text-[8px] font-mono text-gray-500 uppercase tracking-widest leading-none mb-1">AI_Vocalization</p>
                            <p className={`text-[10px] font-mono font-bold leading-none uppercase ${state.audio.status.isActive && state.audio.lastSpeaker !== 'USER' && state.audio.isSpeaking ? 'text-blue-400' : 'text-gray-600'}`}>
                                {state.audio.status.isActive && state.audio.lastSpeaker !== 'USER' && state.audio.isSpeaking ? 'SPEAKING' : 'SILENT'}
                            </p>
                        </div>
                    </div>

                    {/* Vocal Prosody */}
                    <div className="flex items-center gap-3 border-r border-gray-800 pr-6">
                         <div className="p-1.5 rounded-full bg-gray-800 text-rose-400">
                            <Activity size={14} />
                        </div>
                        <div>
                            <p className="text-[8px] font-mono text-gray-500 uppercase tracking-widest leading-none mb-1">Acoustic_Prosody</p>
                            <p className="text-[10px] font-mono font-bold leading-none text-rose-300 uppercase">
                                {state.audio.vocalEmotion || '---'}
                            </p>
                        </div>
                    </div>

                    {/* Promoted Badge (Active during reasoning) */}
                    <div className={`flex items-center gap-2 transition-all duration-700 ${state.autonomous.isProcessingFlashRound ? 'opacity-100' : 'opacity-20'}`}>
                         <div className={`p-1.5 rounded-full ${state.autonomous.isProcessingFlashRound ? 'bg-amber-500/20 text-amber-500 animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
                            <BrainCircuit size={14} />
                        </div>
                        <div className={`px-2 py-0.5 rounded text-[9px] font-black font-mono tracking-tighter transition-all ${state.autonomous.isProcessingFlashRound ? 'bg-amber-500 text-black shadow-[0_0_10px_rgba(245,158,11,0.4)]' : 'bg-gray-800 text-gray-500'}`}>
                            {state.autonomous.isProcessingFlashRound ? 'PROMOTED_REASONING' : 'QUIET_STATE'}
                        </div>
                    </div>
                </div>

                {/* Compact Control Box */}
                <div className="flex items-center gap-2 p-1 bg-black/40 border border-gray-800 rounded-xl shadow-xl">
                    <button 
                        onClick={toggleVoice}
                        title="Toggle Microphone"
                        className={`p-1.5 rounded-lg transition-all ${state.audio.status.isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    >
                        {state.audio.status.isActive ? <Mic size={16} /> : <MicOff size={16} />}
                    </button>
                    <button 
                        onClick={toggleCamera}
                        title="Toggle Camera"
                        className={`p-1.5 rounded-lg transition-all ${state.camera.status.isActive ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    >
                        <Camera size={16} />
                    </button>
                    <button 
                        onClick={toggleScreen}
                        title="Toggle Screen Capture"
                        className={`p-1.5 rounded-lg transition-all ${state.screen.status.isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    >
                        <Monitor size={16} />
                    </button>
                    <button
                        onClick={state.audio.isSpeaking && state.audio.lastSpeaker !== 'USER' ? cancelSpeech : toggleVoiceEnabled}
                        className={`p-1.5 rounded-lg transition-all border-l border-gray-800 pl-2.5 ml-1 ${
                            state.audio.isSpeaking && state.audio.lastSpeaker !== 'USER'
                                ? 'bg-red-600 text-white shadow-lg shadow-red-500/40 animate-pulse' 
                                : voiceEnabled 
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/40' 
                                    : 'bg-gray-800 text-gray-500 hover:text-gray-400'
                        }`}
                        title={state.audio.isSpeaking && state.audio.lastSpeaker !== 'USER' ? "Stop AI Speech" : voiceEnabled ? "Disable AI Voice" : "Enable AI Voice"}
                    >
                        {state.audio.isSpeaking && state.audio.lastSpeaker !== 'USER' ? <AudioLines size={16} /> : voiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                    <button 
                        onClick={toggleAutonomous}
                        title="Toggle Autonomous Help"
                        className={`p-1.5 rounded-lg transition-all ${isAutonomousEnabled ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    >
                        {isAutonomousEnabled ? <Zap size={16} /> : <ZapOff size={16} />}
                    </button>
                </div>
            </div>
            
            {/* 2. EVEN FOUR SQUARE THEATER BODY */}
            <div className="flex-1 flex flex-col min-h-0">
                
                {/* Row 1: Camera | Audio (Table) */}
                <div className="flex-1 flex min-h-0 border-b border-gray-800">
                    {/* Camera Quadrant */}
                    <div className="w-1/2 bg-black relative flex items-center justify-center overflow-hidden group border-r border-gray-800">
                        {state.camera.lastFrame && state.camera.status.isActive ? (
                            <div className="relative h-full w-full flex items-center justify-center">
                                <img 
                                    src={state.camera.lastFrame} 
                                    className="max-h-full max-w-full object-cover" 
                                    alt="Camera" 
                                />
                                <div className="absolute inset-0 pointer-events-none">
                                    {state.camera.people.map(person => (
                                        <div 
                                            key={person.id}
                                            className="absolute border-2 border-emerald-500/40 bg-emerald-500/5 rounded-sm"
                                            style={{
                                                left: `${person.bbox[0]}%`,
                                                top: `${person.bbox[1]}%`,
                                                width: `${person.bbox[2]}%`,
                                                height: `${person.bbox[3]}%`
                                            }}
                                        >
                                            <div className="absolute -top-4 left-[-2px] bg-emerald-500 text-black text-[8px] font-black px-1.5 py-0.5 uppercase rounded-t-sm shadow-lg">
                                                {person.expression}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-3 opacity-20 group-hover:opacity-40 transition-opacity">
                                <Camera size={48} className="text-emerald-500" />
                                <span className="text-xs font-mono uppercase tracking-[0.4em]">Optical_Link_Offline</span>
                            </div>
                        )}
                        <div className="absolute top-3 left-3 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md border border-white/10 text-[9px] font-mono uppercase tracking-widest text-emerald-400">Camera</div>
                    </div>

                    {/* Audio Quadrant (Table Format) */}
                    <div className="w-1/2 flex flex-col bg-gray-950/60 relative overflow-hidden">
                        <div className="flex-1 overflow-y-auto scrollbar-none">
                            <table className="w-full text-left border-collapse font-mono text-[11px]">
                                <thead className="sticky top-0 bg-gray-900 z-20">
                                    <tr className="border-b border-gray-800">
                                        <th className="px-4 py-2 text-gray-500 uppercase tracking-widest font-black w-16"><Clock size={10} /></th>
                                        <th className="px-4 py-2 text-gray-500 uppercase tracking-widest font-black w-24">Speaker</th>
                                        <th className="px-4 py-2 text-gray-500 uppercase tracking-widest font-black w-24">Prosody</th>
                                        <th className="px-4 py-2 text-gray-500 uppercase tracking-widest font-black">Content</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {state.audio.transcript.map((entry, i) => (
                                        <tr key={i} className="border-b border-gray-800/40 hover:bg-white/5 transition-colors">
                                            <td className="px-4 py-2 text-gray-600 tabular-nums">
                                                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </td>
                                            <td className={`px-4 py-2 font-bold ${entry.speaker === 'AI' ? 'text-emerald-400' : 'text-indigo-400'}`}>
                                                {entry.speaker}
                                            </td>
                                            <td className="px-4 py-2 text-rose-400/80 uppercase text-[9px]">
                                                {entry.emotion}
                                            </td>
                                            <td className="px-4 py-2 text-gray-300 leading-relaxed">
                                                {entry.text}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(state.audio.transcript.length === 0) && (
                                <div className="h-full flex flex-col items-center justify-center opacity-10 py-12 text-center">
                                    <Activity size={32} className="mb-4 mx-auto animate-pulse text-indigo-500" />
                                    <p className="text-[10px] uppercase tracking-[0.3em]">Awaiting_Acoustic_Input...</p>
                                </div>
                            )}
                            <div ref={transcriptEndRef} />
                        </div>
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md border border-white/10 text-[9px] font-mono uppercase tracking-widest text-indigo-400">Audio</div>
                    </div>
                </div>

                {/* Row 2: Screen | Attention (Table) */}
                <div className="flex-1 flex min-h-0">
                    {/* Screen Quadrant */}
                    <div className="w-1/2 bg-black relative flex items-center justify-center overflow-hidden group border-r border-gray-800">
                        {state.screen.lastFrame && state.screen.status.isActive ? (
                            <img src={state.screen.lastFrame} className="max-h-full max-w-full object-contain" alt="Screen" />
                        ) : (
                            <div className="flex flex-col items-center gap-3 opacity-20 group-hover:opacity-40 transition-opacity">
                                <Monitor size={48} className="text-blue-500" />
                                <span className="text-xs font-mono uppercase tracking-[0.4em]">Screen_Buffer_Offline</span>
                            </div>
                        )}
                        <div className="absolute top-3 left-3 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md border border-white/10 text-[9px] font-mono uppercase tracking-widest text-blue-400">Screen</div>
                        {state.screen.status.isActive && state.screen.activeApplication && (
                            <div className="absolute bottom-3 left-3 right-3 px-3 py-1.5 bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-[10px] font-mono text-gray-300 truncate">
                                {state.screen.activeApplication}
                            </div>
                        )}
                    </div>

                    {/* Attention Quadrant (Table Format) */}
                    <div className="w-1/2 flex flex-col bg-gray-900/20 relative overflow-hidden">
                        <div className="flex-1 overflow-y-auto scrollbar-none">
                            <table className="w-full text-left border-collapse font-mono text-[11px]">
                                <thead className="sticky top-0 bg-gray-900 z-20">
                                    <tr className="border-b border-gray-800">
                                        <th className="px-4 py-2 text-gray-500 uppercase tracking-widest font-black w-16"><Clock size={10} /></th>
                                        <th className="px-4 py-2 text-gray-500 uppercase tracking-widest font-black">Reason</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {state.autonomous.recentSpikeTimeline.map((spike, i) => (
                                        <tr key={i} className="border-b border-gray-800/40 hover:bg-white/5 transition-colors">
                                            <td className="px-4 py-2 text-gray-600 tabular-nums">
                                                {new Date(spike.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </td>
                                            <td className="px-4 py-2 text-gray-300 leading-relaxed font-light">
                                                {spike.reason}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {state.autonomous.recentSpikeTimeline.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center opacity-10 py-12 text-center">
                                    <ShieldAlert size={32} className="mb-4 mx-auto text-gray-500" />
                                    <p className="text-[10px] uppercase tracking-[0.3em]">Zero_Anomalies_Detected</p>
                                </div>
                            )}
                        </div>
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md border border-white/10 text-[9px] font-mono uppercase tracking-widest text-rose-500">Attention</div>
                    </div>
                </div>

            </div>
        </div>
    );
};
