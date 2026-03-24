
import React, { useState, useRef, useEffect } from 'react';
import { SendHorizontal, Loader2, Square, Plus } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string, options?: { viaVoice?: boolean, attachments?: { id: string, filename: string, type: string }[] }) => void;
  onStop?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onStop, disabled, isProcessing }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ id: string, filename: string, type: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  const handleSubmit = () => {
    if (text.trim() || attachments.length > 0) {
      onSend(text, { attachments });
      setText('');
      setAttachments([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      setIsUploading(true);
      try {
          alert("File uploads will be handled via native OS dialogs in the next update.");
      } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  return (
    <div className="bg-transparent">
        <div className={`relative flex items-end gap-2 p-3 rounded-2xl border border-gray-800 bg-gray-900 focus-within:border-gray-700 transition-all`}>
          <button
            type="button"
            onClick={handleFileClick}
            disabled={disabled || isUploading}
            className="p-2 text-gray-500 hover:text-gray-300 disabled:opacity-40 transition-colors"
          >
            {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}
          </button>
          
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple />

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Execute symbolic instruction..."
            disabled={disabled}
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2 max-h-[200px] resize-none overflow-y-auto text-gray-200 placeholder:text-gray-600 font-sans"
          />

          <div className="flex items-center gap-1">
            {isProcessing ? (
              <button
                type="button"
                onClick={onStop}
                className="p-2 bg-red-900/20 text-red-400 rounded-xl hover:bg-red-900/40 transition-colors"
              >
                <Square size={18} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || (!text.trim() && attachments.length === 0)}
                className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 transition-all shadow-lg shadow-indigo-500/10"
              >
                <SendHorizontal size={18} />
              </button>
            )}
          </div>
        </div>
        
        <div className="text-center mt-3 text-[9px] text-gray-600 font-mono uppercase tracking-[0.3em] opacity-50">
            SignalZero Kernel • Relational Persistence Active
        </div>
    </div>
  );
};
