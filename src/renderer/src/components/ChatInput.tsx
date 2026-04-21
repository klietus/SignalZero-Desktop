
import React, { useState, useRef, useEffect } from 'react';
import { 
    SendHorizontal, Loader2, Square, Plus, Smile, X, 
    FileUp, Camera, Image as ImageIcon, Mic, MicOff, Monitor 
} from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string, options?: { 
      attachments?: { id: string, filename: string, type: string, thumbnail?: string }[],
      metadata?: Record<string, any>
  }) => void;
  onStop?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
  activeContextId?: string | null;
  pendingAttachments?: any[];
  onClearPendingAttachments?: () => void;
  realtimeStatus?: any;
}

const COMMON_EMOJIS = [
    '😊', '😂', '🤣', '❤️', '👍', '🙏', '🔥', '✨', 
    '🤔', '👀', '🚀', '✅', '❌', '⚠️', '💡', '🧠',
    '💻', '📱', '🔒', '🌐', '📊', '⚡', '🛠️', '⚙️'
];

export const ChatInput: React.FC<ChatInputProps> = ({ 
    onSend, onStop, disabled, isProcessing, activeContextId,
    pendingAttachments, onClearPendingAttachments, realtimeStatus
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ id: string, filename: string, type: string, thumbnail?: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  
  // Voice State (Now synced with realtimeStatus)
  const isVoiceMode = !!realtimeStatus?.audio?.isActive;
  const [isAwake, setIsAwake] = useState(false);
  const [systemName, setSystemName] = useState('Signal');

  // Camera/Screen State (Now synced with realtimeStatus)
  const isCameraEnabled = !!realtimeStatus?.camera?.isActive;
  const isScreenVisionEnabled = !!realtimeStatus?.screen?.isActive;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // REFS to avoid stale closures
  const textRef = useRef('');
  const attachmentsRef = useRef<any[]>([]);
  const onSendRef = useRef(onSend);
  const isProcessingRef = useRef(isProcessing);
  
  useEffect(() => { textRef.current = text; }, [text]);
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => { onSendRef.current = onSend; }, [onSend]);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Sync System Name
  useEffect(() => {
    window.api.getSettings().then(s => {
        if (s?.inference?.systemName) setSystemName(s.inference.systemName);
    }).catch(() => {});
  }, []);

  // Handle Camera Stream
  useEffect(() => {
    async function startCamera() {
        if (isCameraEnabled) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { width: 640, height: 480 },
                    audio: false // Explicitly disable audio to prevent resource conflict
                });
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error("Failed to start camera", err);
                window.api.stopRealtimeStream('camera');
            }
        } else {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        }
    }
    startCamera();
    return () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
    };
  }, [isCameraEnabled]);

  // Listen for Kernel Events (Wake Word Visual Feedback)
  useEffect(() => {
      const removeListener = window.api.onKernelEvent((type, data) => {
          if (type === 'CONTEXT_UPDATED' && data.type === 'voice_wake_word_detected') {
              setIsAwake(true);
              // Visual "awake" for 5 seconds
              setTimeout(() => setIsAwake(false), 5000);
          }
      });
      return () => removeListener();
  }, []);

  // Listen for STT results from main
  useEffect(() => {
      const unbindStt = window.api.onSttResult((recognizedText) => {
          setText(recognizedText);
      });

      const unbindSubmit = (window.api as any).onTriggerSubmit?.((data: { text: string, speaker?: string }) => {
          if (isProcessingRef.current) return;
          handleSubmit(data.text, { voice_authenticated_username: data.speaker });
      }) || (() => {});

      return () => {
          unbindStt();
          unbindSubmit();
      };
  }, []);

  // Listen for Audio Playback from main
  useEffect(() => {
      const removeListener = window.api.onPlayAudio(({ audio, samplingRate }) => {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const buffer = ctx.createBuffer(1, audio.length, samplingRate);
          buffer.getChannelData(0).set(audio);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start();
      });
      return () => removeListener();
  }, []);

  const toggleVoiceMode = async () => {
      const newMode = !isVoiceMode;
      try {
          await window.api.toggleVoiceMode(newMode);
          // isVoiceMode will update via realtimeState prop in next render
          if (!newMode) setIsAwake(false);
      } catch (err) {
          console.error("Failed to toggle voice mode", err);
      }
  };

  const toggleCamera = () => {
      if (isCameraEnabled) window.api.stopRealtimeStream('camera');
      else window.api.startRealtimeStream('camera');
  };

  const toggleScreenVision = () => {
      if (isScreenVisionEnabled) window.api.stopRealtimeStream('screen');
      else window.api.startRealtimeStream('screen');
  };

  // Sync global pending attachments
  useEffect(() => {
      if (pendingAttachments && pendingAttachments.length > 0) {
          setAttachments(prev => [...prev, ...pendingAttachments]);
          if (onClearPendingAttachments) onClearPendingAttachments();
      }
  }, [pendingAttachments, onClearPendingAttachments]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as unknown as Node;
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(target)) setShowEmojiPicker(false);
      if (attachMenuRef.current && !attachMenuRef.current.contains(target)) setShowAttachMenu(false);
    };
    if (showEmojiPicker || showAttachMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker, showAttachMenu]);

  const handleSubmit = async (overrideText?: string, metadata?: Record<string, any>) => {
    const currentText = overrideText || textRef.current;
    let currentAtts = [...attachmentsRef.current];

    if (currentText.trim() || currentAtts.length > 0) {
      setIsUploading(true);
      try {
          onSendRef.current(currentText, { attachments: currentAtts, metadata });
          setText('');
          setAttachments([]);
          setShowEmojiPicker(false);
      } catch (err) {
          console.error("Submit failed", err);
      } finally {
          setIsUploading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileClick = () => {
      setShowAttachMenu(false);
      fileInputRef.current?.click();
  };

  const handleCaptureScreenshot = async () => {
      setShowAttachMenu(false);
      setIsUploading(true);
      try {
          const result = await window.api.captureScreenshot();
          if (result) setAttachments(prev => [...prev, result]);
      } catch (err) {
          console.error("Screenshot failed", err);
      } finally {
          setIsUploading(false);
      }
  };

  const handleEmojiSelect = (emoji: string) => {
      if (textareaRef.current) {
          const start = textareaRef.current.selectionStart;
          const end = textareaRef.current.selectionEnd;
          const newText = text.substring(0, start) + emoji + text.substring(end);
          setText(newText);
          setTimeout(() => {
              if (textareaRef.current) {
                  const newCursorPos = start + emoji.length;
                  textareaRef.current.focus();
                  textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
              }
          }, 0);
      } else {
          setText(prev => prev + emoji);
      }
  };

  const handleEmojiClick = () => {
    if (window.api.platform === 'darwin') window.api.showEmojiPicker();
    else setShowEmojiPicker(prev => !prev);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      setIsUploading(true);
      try {
          const newAttachments = [...attachments];
          for (let i = 0; i < files.length; i++) {
              const result = await window.api.processAttachment({
                  name: files[i].name,
                  path: (files[i] as any).path,
                  type: files[i].type
              });
              newAttachments.push(result);
          }
          setAttachments(newAttachments);
      } catch (err) {
          console.error("Attachment failed", err);
      } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  return (
    <div className="bg-transparent relative">
        {showEmojiPicker && (
            <div ref={emojiPickerRef} className="absolute bottom-full left-0 mb-4 p-2 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="grid grid-cols-6 gap-1">
                    {COMMON_EMOJIS.map(emoji => (
                        <button key={emoji} onClick={() => handleEmojiSelect(emoji)} className="w-8 h-8 flex items-center justify-center hover:bg-gray-800 rounded-lg transition-colors text-lg">
                            {emoji}
                        </button>
                    ))}
                </div>
            </div>
        )}

        {showAttachMenu && (
            <div ref={attachMenuRef} className="absolute bottom-full left-0 mb-4 w-48 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 overflow-hidden">
                <div className="flex flex-col p-1">
                    <button onClick={handleFileClick} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800 text-gray-300 text-xs font-bold transition-colors rounded-lg group text-left">
                        <FileUp size={16} className="text-gray-500 group-hover:text-indigo-400" />
                        Upload Files
                    </button>
                    <button onClick={handleCaptureScreenshot} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800 text-gray-300 text-xs font-bold transition-colors rounded-lg group text-left">
                        <Camera size={16} className="text-gray-500 group-hover:text-emerald-400" />
                        Capture Screenshot
                    </button>
                </div>
            </div>
        )}

        {attachments.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-3 px-1">
                {attachments.map(att => (
                    <div key={att.id} className="relative group animate-in zoom-in-95 duration-200">
                        {att.thumbnail || att.type.startsWith('image/') ? (
                            <div className="w-16 h-16 rounded-xl border border-gray-800 bg-gray-900 overflow-hidden shadow-lg group-hover:border-indigo-500/50 transition-all">
                                <img src={att.thumbnail || (att as any).url} alt={att.filename} className="w-full h-full object-cover" />
                            </div>
                        ) : (
                            <div className="w-16 h-16 rounded-xl border border-gray-800 bg-gray-900 flex flex-col items-center justify-center gap-1 shadow-lg group-hover:border-indigo-500/50 transition-all">
                                <div className="p-1.5 bg-indigo-500/10 rounded-lg">
                                    <ImageIcon size={16} className="text-indigo-400" />
                                </div>
                                <span className="text-[8px] text-gray-500 font-bold uppercase tracking-tighter truncate w-12 text-center">{att.filename.split('.').pop()}</span>
                            </div>
                        )}
                        <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 text-white rounded-full border border-gray-700 flex items-center justify-center hover:bg-red-600 transition-colors shadow-md opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100">
                            <X size={10} />
                        </button>
                    </div>
                ))}
            </div>
        )}

        <div className={`relative flex items-end gap-1 p-3 rounded-2xl border ${isVoiceMode ? (isAwake ? 'border-emerald-500 bg-emerald-500/5 shadow-emerald-500/20' : 'border-indigo-500 bg-indigo-500/5 shadow-indigo-500/20') : 'border-gray-800 bg-gray-900'} transition-all`}>
          <div className="flex items-center">
            <button type="button" onClick={() => setShowAttachMenu(prev => !prev)} disabled={disabled || isUploading} className={`p-2 transition-colors ${showAttachMenu ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'} disabled:opacity-40`} title="Attachment options">
                {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            </button>
            <button type="button" onClick={handleEmojiClick} disabled={disabled} className={`p-2 transition-colors ${showEmojiPicker ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'} disabled:opacity-40`} title="Emoji palette">
                <Smile size={18} />
            </button>
          </div>
          
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple />

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isVoiceMode ? (isAwake ? `Listening for speech...` : `Say "${systemName}" to start...`) : "Execute symbolic instruction..."}
            disabled={disabled}
            className={`flex-1 bg-transparent border-none focus:ring-0 focus:outline-none outline-none text-sm py-2 max-h-[200px] resize-none overflow-y-auto text-gray-200 placeholder:text-gray-600 font-sans ${isAwake ? 'animate-pulse' : ''}`}
          />

          <div className="flex items-center gap-1 pl-2">
            <button
                type="button"
                onClick={toggleScreenVision}
                disabled={!activeContextId}
                className={`p-2 rounded-xl transition-all ${isScreenVisionEnabled ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/40' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                title={isScreenVisionEnabled ? "Disable Screen Vision" : "Enable Screen Vision"}
            >
                <Monitor size={18} />
            </button>
            <button
                type="button"
                onClick={toggleCamera}
                disabled={!activeContextId}
                className={`p-2 rounded-xl transition-all ${isCameraEnabled ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/40' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                title={isCameraEnabled ? "Disable Camera" : "Enable Camera"}
            >
                <Camera size={18} />
            </button>
            <button type="button" onClick={toggleVoiceMode} disabled={!activeContextId} className={`p-2 rounded-xl transition-all ${isVoiceMode ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/40' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`} title={isVoiceMode ? "Disable Voice Mode" : "Enable Voice Mode"}>
                {isVoiceMode ? <Mic size={18} /> : <MicOff size={18} />}
            </button>

            {isProcessing ? (
              <button type="button" onClick={onStop} className="p-2 bg-red-900/20 text-red-400 rounded-xl hover:bg-red-900/40 transition-colors">
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button type="button" onClick={() => handleSubmit()} disabled={disabled || (!text.trim() && attachments.length === 0 && !isCameraEnabled)} className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 transition-all shadow-lg shadow-indigo-500/10">
                <SendHorizontal size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Hidden video for frame capture */}
        <video ref={videoRef} autoPlay playsInline muted className="hidden" />
    </div>
  );
};
