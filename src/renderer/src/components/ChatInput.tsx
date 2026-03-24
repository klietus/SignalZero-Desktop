import React, { useState, useRef, useEffect } from 'react';
import { SendHorizontal, Loader2, Mic, Square, Plus, FileUp, X, Play, MicOff } from 'lucide-react';
import { uploadFile, getMicStatus, toggleMic } from '../services/api';

interface ChatInputProps {
  onSend: (message: string, options?: { viaVoice?: boolean, attachments?: { id: string, filename: string, type: string }[] }) => void;
  onStop?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onStop, disabled, isProcessing }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ id: string, filename: string, type: string }[]>([]);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef('');

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // Sync Mic and Story Status with Server
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const micStatus = await getMicStatus();
        setIsMicOn(micStatus.enabled);
      } catch (e) {
        console.error("Failed to fetch status", e);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  // Maintain focus when re-enabled
  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [disabled]);

  const processFile = async (file: File) => {
      setIsUploading(true);
      try {
          const result = await uploadFile(file);
          if (result && result.attachmentId) {
             setAttachments(prev => [...prev, { 
                 id: result.attachmentId, 
                 filename: result.filename, 
                 type: result.document.type 
             }]);
             
              if (textareaRef.current) {
                  textareaRef.current.focus();
              }
          }
      } catch (error) {
          console.error("Upload failed", error);
          alert(`Upload failed: ${String(error)}`);
      } finally {
          setIsUploading(false);
          setIsDragging(false);
          if (fileInputRef.current) {
              fileInputRef.current.value = '';
          }
      }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled && !isUploading) {
          setIsDragging(true);
      }
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled || isUploading) return;
      
      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
      else setIsDragging(false);
  };

  const removeAttachment = (id: string) => {
      setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSubmit = (fromVoice: boolean = false, e?: React.FormEvent) => {
    e?.preventDefault();
    if ((textRef.current.trim() || attachments.length > 0) && !disabled) {
      let finalMessage = textRef.current.trim();
      
      if (attachments.length > 0) {
          const attachmentBlock = `<attachments>${JSON.stringify(attachments)}</attachments>`;
          finalMessage = finalMessage ? `${finalMessage}\n\n${attachmentBlock}` : attachmentBlock;
      }

      onSend(finalMessage, { viaVoice: fromVoice, attachments: [...attachments] });
      setText('');
      setAttachments([]);
      
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    }
  };

  const handleMicToggle = async () => {
    const newState = !isMicOn;
    setIsMicOn(newState); // Optimistic update
    try {
      await toggleMic(newState);
    } catch (e) {
      console.error("Failed to toggle mic", e);
      setIsMicOn(!newState); // Revert on error
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 p-4 sticky bottom-0 z-10 transition-colors duration-300">
      <div className="max-w-full mx-auto relative px-2">
        {/* Attachments Area */}
        {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-1">
                {attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-2 bg-gray-200 dark:bg-gray-800 rounded-md px-3 py-1.5 text-xs font-mono text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 animate-in zoom-in-95">
                        <FileUp size={14} className="text-emerald-600 dark:text-emerald-400" />
                        <span className="max-w-[150px] truncate" title={att.filename}>{att.filename}</span>
                        <button 
                            onClick={() => removeAttachment(att.id)}
                            className="ml-1 p-0.5 rounded-full hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-500 hover:text-red-500 transition-colors"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
            </div>
        )}

        <form onSubmit={(e) => handleSubmit(false, e)} className="relative flex items-end gap-2">
            
          <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileSelect}
              accept=".txt,.md,.pdf,.json,.xml,.html,.rss,.js,.ts,.py,.csv,.png,.jpg,.jpeg,.gif,.webp"
          />

          <button
            type="button"
            disabled={disabled || isUploading}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`p-2 mb-1 rounded-full transition-all duration-200 ${ 
                isDragging 
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 scale-110 ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-gray-900' 
                : 'text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
            title="Attach file (Click or Drag & Drop)"
          >
             {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isUploading ? "Uploading and parsing..." : "Enter symbolic input or natural language..."}
            rows={1}
            disabled={disabled || isUploading}
            className="w-full bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg py-3 pl-4 pr-28 resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500/50 border border-transparent dark:border-gray-800 transition-all max-h-32 disabled:opacity-50 disabled:cursor-not-allowed font-sans text-base"
          />

          <div className="absolute right-4 bottom-2 flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={handleMicToggle}
              className={`p-2 rounded-md shadow-sm transition-all ${isMicOn ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'} disabled:opacity-40 disabled:cursor-not-allowed`}
              aria-label={isMicOn ? 'Disable voice server microphone' : 'Enable voice server microphone'}
              title={isMicOn ? 'Voice Server Mic Active' : 'Voice Server Mic Muted'}
            >
              {isMicOn ? <Mic size={16} /> : <MicOff size={16} />}
            </button>

            <button
              type={isProcessing ? "button" : "submit"}
              disabled={((!text.trim() && attachments.length === 0) && !isProcessing) || (disabled && !isProcessing)}
              onClick={isProcessing && onStop ? onStop : undefined}
              className={`p-2 rounded-md shadow-sm transition-all flex items-center justify-center ${ 
                  isProcessing 
                  ? 'bg-red-600 hover:bg-red-700 text-white' 
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
              aria-label={isProcessing ? "Stop generating" : "Send message"}
            >
              {isProcessing ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>
          </div>
        </form>
        <div className="text-center mt-2 text-[10px] text-gray-400 dark:text-gray-600 font-mono">
            SignalZero Kernel • {isMicOn ? 'Voice Server Listening…' : 'Voice Server Muted'}
        </div>
      </div>
    </div>
  );
};