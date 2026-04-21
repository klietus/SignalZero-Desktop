import React, { useState, useEffect } from 'react';
import { Camera, Monitor, Mic, MicOff, Loader2 } from 'lucide-react';
import { Header, HeaderProps } from '../Header';

interface AudioStreamState {
    lastSpeaker: string | null;
    recognitionConfidence: number;
    isSpeaking: boolean;
    rmsLevel: number;
    runningTranscript: string;
    vocalEmotion: string;
    status: { isActive: boolean; isError: boolean; errorMessage?: string };
}

interface DetectedObject {
    label: string;
    confidence: number;
    bbox: [number, number, number, number];
}

interface PersonDetection {
    id: string;
    expression: string;
    attributes: Record<string, any>;
    bbox: [number, number, number, number];
}

interface CameraStreamState {
    lastFrame: string | null;
    detectedObjects: DetectedObject[];
    people: PersonDetection[];
    timestamp: number;
    status: { isActive: boolean; isError: boolean; errorMessage?: string };
}

interface ScreenStreamState {
    lastFrame: string | null;
    activeApplication: string | null;
    ocrText: string;
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

export const RealtimeScreen: React.FC<RealtimeScreenProps> = ({ headerProps }) => {
    const [state, setState] = useState<SceneState | null>(null);

    useEffect(() => {
        // Initial fetch
        window.api.getRealtimeState().then(setState);

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

    if (!state) return (
        <div className="flex-1 flex flex-col min-h-0 bg-gray-950 items-center justify-center">
            <Loader2 className="animate-spin text-indigo-500" size={32} />
        </div>
    );

    return (
        <div className="flex-1 flex flex-col h-full bg-gray-950 overflow-hidden text-gray-100 font-sans">
            <Header {...headerProps} />
            
            <div className="flex-1 flex flex-col p-3 gap-3 min-h-0">
                {/* Top Row: Camera and Screen side-by-side */}
                <div className="flex-[2] grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0 overflow-hidden">
                    
                    {/* Camera Stream */}
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-xl overflow-hidden flex flex-col shadow-inner">
                        <div className="px-3 py-2 border-b border-gray-800/60 flex items-center justify-between bg-gray-900/20">
                            <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded-lg transition-colors ${state.camera.status.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                                    <Camera size={16} />
                                </div>
                                <div>
                                    <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider leading-none">Camera_Link</h3>
                                    <p className="text-[9px] text-gray-500 font-mono mt-0.5">{state.camera.status.isActive ? 'Status: Active' : 'Status: Offline'}</p>
                                </div>
                            </div>
                            <button 
                                onClick={toggleCamera}
                                className={`p-1.5 rounded-lg transition-all ${state.camera.status.isActive ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30' : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'}`}
                            >
                                <Camera size={14} />
                            </button>
                        </div>
                        <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden min-h-0 border-b border-gray-800/40">
                            {state.camera.lastFrame && state.camera.status.isActive ? (
                                <div className="relative h-full w-full flex items-center justify-center">
                                    <img 
                                        src={state.camera.lastFrame} 
                                        className="max-h-full max-w-full block" 
                                        alt="Camera Feed" 
                                    />
                                    <div className="absolute inset-0 pointer-events-none">
                                        {state.camera.people.map(person => (
                                            <div 
                                                key={person.id}
                                                className="absolute border-2 border-emerald-500/60 bg-emerald-500/5 rounded-sm shadow-[0_0_10px_rgba(16,185,129,0.2)] transition-all duration-100"
                                                style={{
                                                    left: `${person.bbox[0]}%`,
                                                    top: `${person.bbox[1]}%`,
                                                    width: `${person.bbox[2]}%`,
                                                    height: `${person.bbox[3]}%`
                                                }}
                                            >
                                                <div className="absolute -top-3.5 left-[-1.5px] bg-emerald-500 text-black text-[7px] font-black px-1 py-0.5 uppercase whitespace-nowrap rounded-t-sm">
                                                    {person.expression}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-gray-800 font-mono text-[9px] uppercase tracking-[0.4em] animate-pulse">
                                    {state.camera.status.isActive ? 'Initializing_Optical_Link...' : 'Perception_Offline'}
                                </div>
                            )}
                        </div>
                        <div className="px-3 py-2 bg-black/20">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <span className="text-[8px] text-gray-500 font-mono uppercase font-bold">Neural Analysis</span>
                                    <div className="mt-1 space-y-2 max-h-[85px] overflow-y-auto pr-1">
                                        {state.camera.status.isActive && state.camera.people.map((p, i) => (
                                            <div key={i} className="bg-gray-800/20 p-1.5 rounded border border-gray-800/40">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-[8px] font-bold font-mono text-emerald-400 uppercase">P_{p.id}</span>
                                                    <span className="text-[7px] font-mono text-gray-600">D_Conf: {Math.round(p.attributes.detection_confidence * 100)}%</span>
                                                </div>
                                                {p.attributes.emotion_scores && (
                                                    <div className="space-y-1.5 mt-1">
                                                        {Object.entries(p.attributes.emotion_scores)
                                                            .sort(([,a], [,b]) => (b as number) - (a as number))
                                                            .slice(0, 4)
                                                            .map(([emotion, score]) => (
                                                            <div key={emotion} className="space-y-0.5">
                                                                <div className="flex justify-between items-center text-[7px] font-mono uppercase leading-none">
                                                                    <span className={p.expression === emotion ? 'text-indigo-400 font-bold' : 'text-gray-500'}>
                                                                        {emotion}
                                                                    </span>
                                                                    <span className="text-gray-600">{Math.round((Number(score) || 0) * 100)}%</span>
                                                                </div>
                                                                <div className="h-1 bg-gray-900/50 rounded-full overflow-hidden border border-gray-800/20">
                                                                    <div 
                                                                        className={`h-full transition-all duration-500 ${p.expression === emotion ? 'bg-indigo-500 shadow-[0_0_5px_rgba(99,102,241,0.5)]' : 'bg-gray-700'}`}
                                                                        style={{ width: `${(Number(score) || 0) * 100}%` }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="border-l border-gray-800/40 pl-3">
                                    <span className="text-[8px] text-gray-500 font-mono uppercase font-bold">World Objects</span>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {state.camera.status.isActive && state.camera.detectedObjects.length > 0 ? (
                                            state.camera.detectedObjects.map((obj, i) => (
                                                <span key={i} className="text-[7px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1 rounded uppercase font-mono">{obj.label}</span>
                                            ))
                                        ) : (
                                            <span className="text-[7px] text-gray-700 font-mono">No_Detections</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Screen Stream */}
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-xl overflow-hidden flex flex-col shadow-inner">
                        <div className="px-3 py-2 border-b border-gray-800/60 flex items-center justify-between bg-gray-900/20">
                            <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded-lg transition-colors ${state.screen.status.isActive ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-500'}`}>
                                    <Monitor size={16} />
                                </div>
                                <div>
                                    <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider leading-none">Screen_Link</h3>
                                    <p className="text-[9px] text-gray-500 font-mono mt-0.5 truncate max-w-[150px]">{state.screen.status.isActive ? (state.screen.activeApplication || 'Initializing...') : 'Feed Disabled'}</p>
                                </div>
                            </div>
                            <button 
                                onClick={toggleScreen}
                                className={`p-1.5 rounded-lg transition-all ${state.screen.status.isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'}`}
                            >
                                <Monitor size={14} />
                            </button>
                        </div>
                        <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden min-h-0 border-b border-gray-800/40">
                            {state.screen.lastFrame && state.screen.status.isActive ? (
                                <img src={state.screen.lastFrame} className="max-h-full max-w-full object-contain" alt="Screen Feed" />
                            ) : (
                                <div className="text-gray-800 font-mono text-[9px] uppercase tracking-[0.4em]">{state.screen.status.isActive ? 'Syncing_Buffer...' : 'Perception_Offline'}</div>
                            )}
                        </div>
                        <div className="px-3 py-2 bg-black/20 flex gap-4">
                            <div className="flex-1">
                                <span className="text-[8px] text-gray-500 font-mono uppercase font-bold">Character_Recognition_Stream</span>
                                <div className="mt-1 bg-black/40 rounded p-2 font-mono text-[9px] text-gray-500 h-20 overflow-y-auto border border-gray-800/60 leading-tight scrollbar-none">
                                    {state.screen.status.isActive ? (state.screen.ocrText || 'Syncing content...') : 'OCR_Suspended'}
                                </div>
                            </div>
                            <div className="w-48 border-l border-gray-800/40 pl-3">
                                <span className="text-[8px] text-gray-500 font-mono uppercase font-bold">Autonomous_Intel</span>
                                <div className="mt-1 space-y-2">
                                    <div className={`p-1.5 rounded border ${state.autonomous.isProcessingFlashRound ? 'bg-indigo-500/10 border-indigo-500/40 animate-pulse' : 'bg-gray-800/20 border-gray-800/40'}`}>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[8px] font-mono text-gray-400">Flash Round:</span>
                                            <span className={`text-[8px] font-mono ${state.autonomous.isProcessingFlashRound ? 'text-indigo-400 font-bold' : 'text-gray-600'}`}>
                                                {state.autonomous.isProcessingFlashRound ? 'EVALUATING' : 'IDLE'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="space-y-1 max-h-[45px] overflow-y-auto pr-1">
                                        {state.autonomous.recentSpikeTimeline.map((spike, i) => (
                                            <div key={i} className="flex items-start gap-1.5 leading-none">
                                                <div className="w-1 h-1 rounded-full bg-rose-500 mt-0.5 shrink-0" />
                                                <span className="text-[7px] font-mono text-gray-400 truncate" title={spike.reason}>{spike.reason}</span>
                                            </div>
                                        ))}
                                        {state.autonomous.recentSpikeTimeline.length === 0 && (
                                            <span className="text-[7px] font-mono text-gray-700 italic">No recent spikes detected</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Audio Diagnostics */}
                <div className="flex-1 min-h-0">
                    <div className="bg-gray-900/40 border border-gray-800/60 rounded-xl overflow-hidden flex flex-col h-full shadow-inner">
                        <div className="px-3 py-2 border-b border-gray-800/60 flex items-center justify-between bg-gray-900/20">
                            <div className="flex items-center gap-2">
                                <div className={`p-1.5 rounded-lg transition-colors ${state.audio.status.isActive ? 'bg-indigo-500/20 text-indigo-400' : 'bg-gray-800 text-gray-500'}`}>
                                    {state.audio.status.isActive ? <Mic size={16} /> : <MicOff size={16} />}
                                </div>
                                <div>
                                    <h3 className="font-mono text-[11px] font-bold uppercase tracking-wider leading-none">Acoustic_Diagnostics</h3>
                                    <div className="flex flex-col gap-1 mt-0.5">
                                        <div className="flex items-center gap-2">
                                            <p className="text-[9px] text-gray-500 font-mono leading-none">Ident:</p>
                                            <span className={`text-[10px] font-mono font-bold leading-none ${
                                                state.audio.recognitionConfidence > 0.7 ? "text-emerald-500" : "text-amber-500"
                                            }`}>
                                                {state.audio.lastSpeaker || 'Listening...'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <p className="text-[9px] text-gray-500 font-mono leading-none">Prosody:</p>
                                            <span className="text-[9px] font-mono text-indigo-400 uppercase">{state.audio.vocalEmotion}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex flex-col items-end mr-1">
                                    <span className="text-[7px] text-gray-600 font-mono uppercase font-bold tracking-tighter">Confidence</span>
                                    <span className="text-[10px] font-mono text-rose-400 leading-none">{state.audio.status.isActive ? `${Math.round(state.audio.recognitionConfidence * 100)}%` : '0%'}</span>
                                </div>
                                <div className={`w-2.5 h-2.5 rounded-full ${state.audio.status.isActive && state.audio.isSpeaking ? 'bg-rose-500 animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-gray-800'}`} />
                                <button 
                                    onClick={toggleVoice}
                                    className={`p-1.5 rounded-lg transition-all ${state.audio.status.isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'}`}
                                >
                                    {state.audio.status.isActive ? <Mic size={14} /> : <MicOff size={14} />}
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 flex gap-4 p-3 min-h-0 overflow-hidden">
                            <div className="flex-1 flex flex-col min-h-0 bg-black/20 rounded-lg border border-gray-800/40 p-3">
                                <span className="text-[8px] text-gray-500 font-mono uppercase font-bold mb-1.5">Transcription_History_Buffer</span>
                                <div className="text-[12px] font-mono text-gray-300 overflow-y-auto leading-relaxed scrollbar-none whitespace-pre-wrap flex flex-col-reverse">
                                    {state.audio.status.isActive ? (state.audio.runningTranscript || 'Awaiting_Signal') : 'Awaiting_Signal'}
                                </div>
                            </div>
                            <div className="w-24 flex flex-col justify-center border-l border-gray-800/40 pl-4">
                                <span className="text-[8px] text-gray-500 font-mono uppercase mb-2 font-bold text-center">Intensity</span>
                                <div className="flex-1 w-3 bg-gray-900 rounded-full mx-auto relative overflow-hidden border border-gray-800/60">
                                    <div 
                                        className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-indigo-600 to-rose-400 transition-all duration-75 shadow-lg" 
                                        style={{ height: `${state.audio.status.isActive ? Math.min(100, state.audio.rmsLevel * 200) : 0}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
