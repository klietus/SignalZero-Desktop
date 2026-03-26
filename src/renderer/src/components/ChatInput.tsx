
import React, { useState, useRef, useEffect } from 'react';
import { SendHorizontal, Loader2, Square, Plus, Smile } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string, options?: { attachments?: { id: string, filename: string, type: string }[] }) => void;
  onStop?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

const COMMON_EMOJIS = [
    '😊', '😂', '🤣', '❤️', '👍', '🙏', '🔥', '✨', 
    '🤔', '👀', '🚀', '✅', '❌', '⚠️', '💡', '🧠',
    '💻', '📱', '🔒', '🌐', '📊', '⚡', '🛠️', '⚙️'
];

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, onStop, disabled, isProcessing }) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ id: string, filename: string, type: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as unknown as Node)) {
        setShowEmojiPicker(false);
      }
    };
    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  const handleSubmit = () => {
    if (text.trim() || attachments.length > 0) {
      onSend(text, { attachments });
      setText('');
      setAttachments([]);
      setShowEmojiPicker(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileClick = () => fileInputRef.current?.click();

  const handleEmojiSelect = (emoji: string) => {
      if (textareaRef.current) {
          const start = textareaRef.current.selectionStart;
          const end = textareaRef.current.selectionEnd;
          const newText = text.substring(0, start) + emoji + text.substring(end);
          setText(newText);
          
          // Focus back to textarea and set cursor after emoji
          setTimeout(() => {
              if (textareaRef.current) {
                  textareaRef.current.focus();
                  const newCursorPos = start + emoji.length;
                  textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
              }
          }, 0);
      } else {
          setText(prev => prev + emoji);
      }
  };

  const handleEmojiClick = () => {
    if (window.api.platform === 'darwin') {
      window.api.showEmojiPicker();
    } else {
      setShowEmojiPicker(prev => !prev);
    }
  };

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
    <div className="bg-transparent relative">
        {/* Emoji Picker Overlay */}
        {showEmojiPicker && (
            <div 
                ref={emojiPickerRef}
                className="absolute bottom-full left-0 mb-4 p-2 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-200"
            >
                <div className="grid grid-cols-6 gap-1">
                    {COMMON_EMOJIS.map(emoji => (
                        <button
                            key={emoji}
                            onClick={() => handleEmojiSelect(emoji)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-gray-800 rounded-lg transition-colors text-lg"
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            </div>
        )}

        <div className={`relative flex items-end gap-1 p-3 rounded-2xl border border-gray-800 bg-gray-900 transition-all`}>
          <div className="flex items-center">
            <button
                type="button"
                onClick={handleFileClick}
                disabled={disabled || isUploading}
                className="p-2 text-gray-500 hover:text-gray-300 disabled:opacity-40 transition-colors"
                title="Attach file"
            >
                {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            </button>

            <button
                type="button"
                onClick={handleEmojiClick}
                disabled={disabled}
                className={`p-2 transition-colors ${showEmojiPicker ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'} disabled:opacity-40`}
                title="Emoji palette"
            >
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
            placeholder="Execute symbolic instruction..."
            disabled={disabled}
            className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none outline-none text-sm py-2 max-h-[200px] resize-none overflow-y-auto text-gray-200 placeholder:text-gray-600 font-sans"
          />

          <div className="flex items-center gap-1 pl-2">
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
    </div>
  );
};
