
import React, { useState, useEffect } from 'react';
import { Package, Download, Upload, Save, AlertTriangle, FileText, Loader2, Plus, CheckCircle2 } from 'lucide-react';
import { ProjectMeta } from '../../types';
import { Header, HeaderProps } from '../Header';

interface ProjectScreenProps {
  headerProps: Omit<HeaderProps, 'children'>;
  projectMeta: ProjectMeta;
  setProjectMeta: (meta: ProjectMeta) => void;
  systemPrompt: string;
  onSystemPromptChange: (newPrompt: string) => void;
  mcpPrompt: string;
  onMcpPromptChange: (newPrompt: string) => void;
  onNewProject: () => void;
}

export const ProjectScreen: React.FC<ProjectScreenProps> = ({ 
    headerProps,
    projectMeta,
    setProjectMeta,
    systemPrompt, 
    onSystemPromptChange,
    mcpPrompt,
    onMcpPromptChange,
    onNewProject
}) => {
  const [promptText, setPromptText] = useState(systemPrompt);
  const [mcpPromptText, setMcpPromptText] = useState(mcpPrompt);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState({ message: '', progress: 0 });
  
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);

  useEffect(() => { setPromptText(systemPrompt); }, [systemPrompt]);
  useEffect(() => { setMcpPromptText(mcpPrompt); }, [mcpPrompt]);

  useEffect(() => {
      // Listen for import status events from main process
      const removeListener = window.api.onKernelEvent((type, data) => {
          if (type === 'project:import-status') {
              setImportStatus({ message: data.status, progress: data.progress });
              if (data.status === 'COMPLETE') {
                  setTimeout(() => {
                      setIsImporting(false);
                      onNewProject();
                  }, 1500);
              }
              if (data.status === 'FAILED') {
                  alert("Import failed: " + data.error);
                  setIsImporting(false);
              }
          }
      });
      return () => {
          if (typeof removeListener === 'function') removeListener();
      };
  }, [onNewProject]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSavePrompt = async () => {
      setIsSaving(true);
      try {
          await Promise.all([
              window.api.setSystemPrompt(promptText),
              window.api.setMcpPrompt(mcpPromptText)
          ]);
          onSystemPromptChange(promptText);
          onMcpPromptChange(mcpPromptText);
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3000);
      } catch (err) {
          console.error("Failed to update kernel prompts", err);
          alert("Failed to update kernel prompts.");
      } finally {
          setIsSaving(false);
      }
  };

  const handleExportProject = async () => {
      setIsExporting(true);
      try {
          await (window.api as any).exportProject(projectMeta);
      } catch (e) {
          console.error("Export failed", e);
      } finally {
          setIsExporting(false);
      }
  };

  const handleImportClick = async () => {
      try {
          const result = await (window.api as any).importProject();
          if (result && result.success) {
              setIsImporting(true);
              setImportStatus({ message: 'Initializing import...', progress: 0 });
          }
      } catch (err) {
          console.error("Import failed:", err);
          setIsImporting(false);
      }
  };

  const handleLoadSample = async () => {
      try {
          const result = await (window.api as any).importSampleProject();
          if (result && result.success) {
              setIsImporting(true);
              setImportStatus({ message: 'Locating sample project...', progress: 0 });
          }
      } catch (e) {
          console.error("Sample load failed", e);
          setIsImporting(false);
      }
  };

  const handleChangeMeta = (field: keyof ProjectMeta, value: string) => {
      setProjectMeta({ ...projectMeta, [field]: value });
  };

  return (
    <div className="flex flex-col h-full bg-gray-950 font-sans text-gray-200 relative">
      <Header {...headerProps}>
         <div className="flex items-center gap-2">
             <button 
                onClick={() => setIsNewProjectModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-mono font-bold transition-colors"
             >
                 <Plus size={14} /> New Project
             </button>
             <button
                onClick={handleLoadSample}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-mono font-bold transition-colors"
             >
                 <Package size={14} /> Load Sample
             </button>
             <button 
                onClick={handleImportClick}
                disabled={isImporting}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-gray-300 rounded-md text-xs font-mono font-bold transition-colors border border-gray-800"
             >
                 {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                 Import
             </button>
             <button 
                onClick={handleExportProject}
                disabled={isExporting}
                className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-md text-xs font-mono font-bold transition-colors"
             >
                 {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                 Export
             </button>
         </div>
      </Header>

      <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-5xl mx-auto space-y-8">
              
              <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-800/50 pb-4 mb-4">
                      <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono flex items-center gap-2">
                          <Package size={16} /> Project_Metadata
                      </h2>
                      <button
                          onClick={() => {}} 
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest transition-all"
                      >
                          <Save size={14} /> Commit Meta
                      </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 font-mono">Project_Name</label>
                          <input
                              value={projectMeta.name}
                              onChange={(e) => handleChangeMeta('name', e.target.value)}
                              className="w-full bg-black/40 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 focus:border-indigo-500 transition-colors"
                          />
                      </div>
                      <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 font-mono">Version</label>
                          <input 
                              value={projectMeta.version}
                              onChange={(e) => handleChangeMeta('version', e.target.value)}
                              className="w-full bg-black/40 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 focus:border-indigo-500 transition-colors"
                          />
                      </div>
                      <div className="space-y-2">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600 font-mono">Author_Handle</label>
                          <input 
                              value={projectMeta.author}
                              onChange={(e) => handleChangeMeta('author', e.target.value)}
                              className="w-full bg-black/40 border border-gray-800 rounded-lg p-3 text-sm text-gray-300 focus:border-indigo-500 transition-colors"
                          />
                      </div>
                  </div>
              </section>

              <section className="bg-gray-900/40 rounded-2xl p-8 border border-gray-800 shadow-xl space-y-6">
                  <div className="flex items-center justify-between border-b border-gray-800/50 pb-4 mb-4">
                      <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 font-mono flex items-center gap-2">
                          <FileText size={16} /> Activation_Protocol
                      </h2>
                      <button 
                          onClick={handleSavePrompt}
                          disabled={isSaving}
                          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest transition-all ${
                              saveSuccess 
                              ? 'bg-emerald-600 text-white' 
                              : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                          }`}
                      >
                          {isSaving ? <Loader2 size={14} className="animate-spin" /> : (saveSuccess ? <CheckCircle2 size={14} /> : <Save size={14} />)}
                          {isSaving ? 'Updating...' : (saveSuccess ? 'Kernel Updated' : 'Update Kernel')}
                      </button>
                  </div>
                  
                  <div className="bg-amber-900/10 border border-amber-900/30 p-4 rounded-xl text-[11px] text-amber-500/80 flex items-start gap-3 mb-4 font-mono leading-relaxed uppercase tracking-tighter">
                      <AlertTriangle size={16} className="shrink-0" />
                      <span>
                          Kernel_Warning: Modifying the activation protocol fundamentally alters the identity and operational constraints of Axiom. 
                          Changes are atomic and persistent.
                      </span>
                  </div>

                  <textarea 
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      className="w-full h-[500px] bg-black/40 border border-gray-800 rounded-xl p-6 font-mono text-xs leading-relaxed text-gray-400 focus:border-indigo-500 transition-colors resize-none"
                      spellCheck={false}
                  />
              </section>
          </div>
      </div>

      {/* Import Status Overlay */}
      {isImporting && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
              <div className="max-w-md w-full space-y-8 text-center">
                  <div className="relative inline-block">
                      <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full"></div>
                      <Package size={64} className="text-indigo-500 animate-pulse relative z-10 mx-auto" />
                  </div>
                  
                  <div className="space-y-2">
                      <h3 className="text-xl font-light tracking-[0.2em] uppercase text-white">Project_Sync_Active</h3>
                      <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{importStatus.message}</p>
                  </div>

                  <div className="space-y-4">
                      <div className="h-1 w-full bg-gray-900 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-indigo-500 transition-all duration-500 ease-out"
                            style={{ width: `${importStatus.progress}%` }}
                          />
                      </div>
                      <div className="flex justify-between items-center text-[10px] font-mono text-gray-600">
                          <span>{importStatus.progress}% COMPLETE</span>
                          <span>STABLE_RECURSION_PENDING</span>
                      </div>
                  </div>

                  {importStatus.progress === 100 && (
                      <div className="flex items-center justify-center gap-2 text-emerald-500 animate-in fade-in zoom-in duration-500">
                          <CheckCircle2 size={16} />
                          <span className="text-xs font-bold uppercase tracking-widest">Integrity Verified</span>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* New Project Modal */}
      {isNewProjectModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full p-8 border border-gray-800">
                  <h3 className="font-light tracking-[0.2em] uppercase text-gray-100 mb-4 text-center">Reset_Environment?</h3>
                  <p className="text-xs text-gray-500 text-center mb-8 font-mono leading-relaxed">
                      Current symbolic graph and activation protocols will be purged.
                  </p>
                  <div className="flex flex-col gap-3">
                      <button 
                          onClick={() => { window.api.upsertSymbol('root', { id: 'INIT', name: 'Init' }); setIsNewProjectModalOpen(false); }} 
                          className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest transition-all"
                      >
                          Purge & Initialize
                      </button>
                      <button 
                          onClick={() => setIsNewProjectModalOpen(false)} 
                          className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest transition-all"
                      >
                          Abort
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
