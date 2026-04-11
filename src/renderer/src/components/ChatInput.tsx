
import React, { useState, useRef, useEffect } from 'react';
import { SendHorizontal, Loader2, Square, Plus, Smile, X, FileUp, Camera, Image as ImageIcon } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string, options?: { attachments?: { id: string, filename: string, type: string, thumbnail?: string }[] }) => void;
  onStop?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
  pendingAttachments?: any[];
  onClearPendingAttachments?: () => void;
}

const COMMON_EMOJIS = [
    '😊', '😂', '🤣', '❤️', '👍', '🙏', '🔥', '✨', 
    '🤔', '👀', '🚀', '✅', '❌', '⚠️', '💡', '🧠',
    '💻', '📱', '🔒', '🌐', '📊', '⚡', '🛠️', '⚙️'
];

export const ChatInput: React.FC<ChatInputProps> = ({ 
    onSend, onStop, disabled, isProcessing, 
    pendingAttachments, onClearPendingAttachments 
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<{ id: string, filename: string, type: string, thumbnail?: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Sync global pending attachments (like screenshots from tray)
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

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as unknown as Node;
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(target)) {
        setShowEmojiPicker(false);
      }
      if (attachMenuRef.current && !attachMenuRef.current.contains(target)) {
        setShowAttachMenu(false);
      }
    };
    if (showEmojiPicker || showAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker, showAttachMenu]);

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

  const handleFileClick = () => {
      setShowAttachMenu(false);
      fileInputRef.current?.click();
  };

  const handleCaptureScreenshot = async () => {
      setShowAttachMenu(false);
      setIsUploading(true);
      try {
          const result = await window.api.captureScreenshot();
          if (result) {
              setAttachments(prev => [...prev, result]);
          }
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
          const newAttachments = [...attachments];
          for (let i = 0; i < files.length; i++) {
              const file = files[i];
              // In Electron, the path property is available on the File object
              const result = await window.api.processAttachment({
                  name: file.name,
                  path: (file as any).path,
                  type: file.type
              });
              newAttachments.push(result);
          }
          setAttachments(newAttachments);
      } catch (err) {
          console.error("Failed to process attachment", err);
          alert("Failed to process attachment");
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

        {/* Attachment Menu Popover */}
        {showAttachMenu && (
            <div 
                ref={attachMenuRef}
                className="absolute bottom-full left-0 mb-4 w-48 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 overflow-hidden"
            >
                <div className="flex flex-col p-1">
                    <button 
                        onClick={handleFileClick}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800 text-gray-300 text-xs font-bold transition-colors rounded-lg group text-left"
                    >
                        <FileUp size={16} className="text-gray-500 group-hover:text-indigo-400" />
                        Upload Files
                    </button>
                    <button 
                        onClick={handleCaptureScreenshot}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800 text-gray-300 text-xs font-bold transition-colors rounded-lg group text-left"
                    >
                        <Camera size={16} className="text-gray-500 group-hover:text-emerald-400" />
                        Capture Screenshot
                    </button>
                </div>
            </div>
        )}

        {/* Attachments List */}
        {attachments.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-3 px-1">
                {attachments.map(att => (
                    <div key={att.id} className="relative group animate-in zoom-in-95 duration-200">
                        {att.thumbnail || att.type.startsWith('image/') ? (
                            <div className="w-16 h-16 rounded-xl border border-gray-800 bg-gray-900 overflow-hidden shadow-lg group-hover:border-indigo-500/50 transition-all">
                                <img 
                                    src={att.thumbnail || (att as any).url} 
                                    alt={att.filename} 
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        ) : (
                            <div className="w-16 h-16 rounded-xl border border-gray-800 bg-gray-900 flex flex-col items-center justify-center gap-1 shadow-lg group-hover:border-indigo-500/50 transition-all">
                                <div className="p-1.5 bg-indigo-500/10 rounded-lg">
                                    <ImageIcon size={16} className="text-indigo-400" />
                                </div>
                                <span className="text-[8px] text-gray-500 font-bold uppercase tracking-tighter truncate w-12 text-center">{att.filename.split('.').pop()}</span>
                            </div>
                        )}
                        <button 
                            onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 text-white rounded-full border border-gray-700 flex items-center justify-center hover:bg-red-600 transition-colors shadow-md opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100"
                        >
                            <X size={10} />
                        </button>
                    </div>
                ))}
            </div>
        )}

        <div className={`relative flex items-end gap-1 p-3 rounded-2xl border border-gray-800 bg-gray-900 transition-all`}>
          <div className="flex items-center">
            <button
                type="button"
                onClick={() => setShowAttachMenu(prev => !prev)}
                disabled={disabled || isUploading}
                className={`p-2 transition-colors ${showAttachMenu ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300'} disabled:opacity-40`}
                title="Attachment options"
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
