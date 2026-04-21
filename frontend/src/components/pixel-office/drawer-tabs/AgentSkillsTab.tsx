import { useState } from 'react';
import {
  Boxes, ShieldCheck, Blocks, Trash2, Loader2, RefreshCw, AlertCircle,
  PackagePlus, Lock, LockOpen, ChevronDown, ChevronUp, FolderOpen,
  Puzzle, Info,
} from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { useAgentSkills, type AgentSkillEntry } from '../hooks/useAgentSkills';

interface AgentSkillsTabProps {
  agentWorkspace?: string;
}

// ── SkillCard — matches SkillManager.tsx exactly ───────────────────────────

function SkillCard({
  skill,
  isCore,
  coreUnlocked,
  acting,
  onRemove,
  onDeleteCore,
  onMoveToCore,
  onMoveToWorkspace,
  isRemoving,
  isMoving,
}: {
  skill: AgentSkillEntry;
  isCore: boolean;
  coreUnlocked: boolean;
  acting: boolean;
  onRemove?: () => void;
  onDeleteCore?: () => void;
  onMoveToCore?: () => void;
  onMoveToWorkspace?: () => void;
  isRemoving: boolean;
  isMoving: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const badge = isCore
    ? 'bg-violet-500/10 text-violet-500 border-violet-500/20'
    : 'bg-blue-500/10 text-blue-500 border-blue-500/20';

  return (
    <div className={`group flex flex-col bg-white dark:bg-slate-900/40 border rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/5 ${
      isCore
        ? 'border-slate-200 dark:border-slate-800/60'
        : 'border-blue-100 dark:border-blue-900/30 hover:border-blue-400 dark:hover:border-blue-700'
    }`}>
      <div className="p-6 flex flex-col h-full">
        {/* Card header */}
        <div className="flex items-start justify-between mb-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl text-blue-500 group-hover:scale-110 transition-transform duration-300">
            {isCore ? <ShieldCheck size={24} /> : <Blocks size={24} />}
          </div>
          <div className="flex items-center gap-2">
            {!isCore && (
              <>
                {onMoveToCore && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onMoveToCore(); }}
                    disabled={acting}
                    className="p-2 rounded-xl text-slate-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                    title={t('skillManager.actions.moveToCore', 'Move to Core')}
                  >
                    {isMoving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemove?.(); }}
                  disabled={acting}
                  className="p-2 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title={t('skillManager.actions.remove', 'Remove')}
                >
                  {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                </button>
              </>
            )}
            {isCore && (
              <>
                {onMoveToWorkspace && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onMoveToWorkspace(); }}
                    disabled={acting}
                    className="p-2 rounded-xl text-slate-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                    title={t('skillManager.actions.moveToWorkspace', 'Move to Workspace')}
                  >
                    {isMoving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
                  </button>
                )}
                {coreUnlocked && onDeleteCore ? (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onDeleteCore(); }}
                    disabled={acting}
                    className="p-2 rounded-xl text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                    title={t('skillManager.actions.remove', 'Delete')}
                  >
                    {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  </button>
                ) : (
                  <div className="p-2 text-slate-300 dark:text-slate-700" title={t('skillManager.status.systemRequired', 'System required')}>
                    <Lock size={14} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Badge */}
        <div className="mb-2">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${badge}`}>
            {isCore ? 'CORE' : (skill.category || 'workspace')}
          </span>
        </div>

        {/* Title + description */}
        <div className="flex-grow">
          <h4 className="font-bold text-slate-900 dark:text-white text-base mb-1 tracking-tight">{skill.name}</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2 min-h-[2.5rem]">
            {skill.desc}
          </p>
        </div>

        {/* Expand */}
        <div className="mt-4 pt-4 border-t border-slate-50 dark:border-slate-800/50 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] font-bold text-slate-400 hover:text-blue-500 flex items-center gap-1 transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {t('skillManager.actions.viewDetails', 'View Details')}
          </button>
          <div className="text-[10px] font-mono text-slate-300 dark:text-slate-600 truncate max-w-[80px]">
            {skill.id}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-slate-50 dark:bg-black/20 rounded-2xl p-4 border border-slate-100 dark:border-slate-800/50">
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <FolderOpen size={10} /> {t('skillManager.deepConfig', 'Deep Config')}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed italic">
                {skill.details || t('skillManager.status.noDetails', 'No additional details')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AgentSkillsTab({ agentWorkspace }: AgentSkillsTabProps) {
  const { t } = useTranslation();
  const {
    skills, loading, error, scan,
    removeSkill, deleteCoreSkill, moveToCore, moveToWorkspace, importSkill,
  } = useAgentSkills({ agentWorkspace, enabled: true });

  const [activeTab, setActiveTab] = useState<'workspace' | 'core'>('workspace');
  const [coreUnlocked, setCoreUnlocked] = useState(false);
  const [acting, setActing] = useState(false);
  const [scanError, setScanError] = useState('');
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null);
  const [movingSkillId, setMovingSkillId] = useState<string | null>(null);

  const coreSkills = skills.filter(s => s.isCore);
  const workspaceSkills = skills.filter(s => !s.isCore);

  const handleImport = async () => {
    if (acting) return;
    setActing(true);
    try { await importSkill(); setActiveTab('workspace'); }
    catch { /* ignore */ }
    finally { setActing(false); }
  };

  const handleRemove = async (skill: AgentSkillEntry) => {
    if (acting) return;
    if (!confirm(t('skillManager.status.deleteConfirm', { name: skill.name, defaultValue: `Delete "${skill.name}"?` }))) return;
    setActing(true); setRemovingSkillId(skill.id);
    try { await removeSkill(skill.id); }
    catch { /* ignore */ }
    finally { setActing(false); setRemovingSkillId(null); }
  };

  const handleDeleteCore = async (skill: AgentSkillEntry) => {
    if (acting) return;
    if (!confirm(t('skillManager.status.deleteCoreConfirm', { name: skill.name, defaultValue: `Delete core skill "${skill.name}"?` }))) return;
    setActing(true); setRemovingSkillId(skill.id);
    try { await deleteCoreSkill(skill.id); }
    catch { /* ignore */ }
    finally { setActing(false); setRemovingSkillId(null); }
  };

  const handleMoveToCore = async (skill: AgentSkillEntry) => {
    if (acting) return;
    if (!confirm(t('skillManager.status.moveToCoreConfirm', { name: skill.name, defaultValue: `Move "${skill.name}" to Core?` }))) return;
    setActing(true); setMovingSkillId(skill.id);
    try { await moveToCore(skill.id); setActiveTab('core'); }
    catch (e) { setScanError(String(e)); }
    finally { setActing(false); setMovingSkillId(null); }
  };

  const handleMoveToWorkspace = async (skill: AgentSkillEntry) => {
    if (acting) return;
    if (!confirm(t('skillManager.status.moveCoreConfirm', { name: skill.name, defaultValue: `Move "${skill.name}" to Workspace?` }))) return;
    setActing(true); setMovingSkillId(skill.id);
    try { await moveToWorkspace(skill.id); setActiveTab('workspace'); }
    catch (e) { setScanError(String(e)); }
    finally { setActing(false); setMovingSkillId(null); }
  };

  if (!agentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 py-12 text-slate-400">
        <Boxes size={24} className="opacity-30" />
        <p className="text-[11px] text-center px-4">
          {t('memory.noWorkspaceHint')}
        </p>
      </div>
    );
  }

  const tabs = [
    { id: 'workspace' as const, label: t('skillManager.tabs.workspace', 'Workspace'), icon: <Puzzle size={14} />, count: workspaceSkills.length },
    { id: 'core' as const, label: t('skillManager.tabs.core', 'Core'), icon: <ShieldCheck size={14} />, count: coreSkills.length },
  ];

  return (
    <div className="space-y-8 pb-20 p-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-6">
        <div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white flex items-center tracking-tight">
            <span className="w-2 h-8 bg-blue-500 rounded-full mr-4 shadow-lg shadow-blue-500/20" />
            {t('skillManager.title', 'Skills')}
          </h3>
          <p className="text-sm text-slate-400 mt-1 font-medium ml-6">
            {activeTab === 'core'
              ? t('skillManager.guide.core', 'Core skills loaded at system level')
              : <Trans i18nKey="skillManager.guide.workspace" components={[<span key="skills-dir" className="font-mono font-semibold text-slate-600 dark:text-slate-300" />]} />}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'workspace' && (
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={acting}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 dark:bg-blue-600 dark:border-blue-500 dark:hover:bg-blue-500 text-white rounded-2xl text-xs font-black transition-all shadow-xl shadow-slate-200 dark:shadow-blue-900/30 active:scale-95 disabled:opacity-50"
            >
              <PackagePlus size={16} />
              {t('skillManager.actions.import', 'Import')}
            </button>
          )}
          {activeTab === 'core' && (
            <button
              type="button"
              onClick={() => setCoreUnlocked(v => !v)}
              disabled={acting}
              className={`p-3 rounded-2xl border transition-all disabled:opacity-40 ${
                coreUnlocked
                  ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-500 shadow-lg shadow-amber-200/50 dark:shadow-amber-900/30'
                  : 'border-slate-200 dark:border-slate-800 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title={coreUnlocked ? t('skillManager.actions.lockCore', 'Lock core') : t('skillManager.actions.unlockCore', 'Unlock to edit')}
            >
              {coreUnlocked ? <LockOpen size={18} /> : <Lock size={18} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => void scan()}
            disabled={loading || acting}
            className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-40"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Errors */}
      {(error || scanError) && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-2xl text-xs text-red-600 dark:text-red-400 font-medium animate-in fade-in duration-200">
          <AlertCircle size={14} className="shrink-0" />
          {error || scanError}
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100/50 dark:bg-slate-900/50 p-1.5 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 max-w-sm">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl text-xs font-black transition-all duration-300 ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xl shadow-slate-200/50 dark:shadow-black/20 border border-slate-200/50 dark:border-slate-700'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
            }`}
          >
            {tab.icon}
            {tab.label}
            <span className="ml-2 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded-md text-[9px] opacity-70">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-slate-400" />
        </div>
      )}

      {/* Skill grid */}
      {!loading && (
        <div className="animate-in fade-in duration-500 slide-in-from-bottom-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {activeTab === 'core' ? (
              coreSkills.length > 0 ? coreSkills.map(skill => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  isCore
                  coreUnlocked={coreUnlocked}
                  acting={acting || loading}
                  onMoveToWorkspace={() => void handleMoveToWorkspace(skill)}
                  onDeleteCore={() => void handleDeleteCore(skill)}
                  isRemoving={removingSkillId === skill.id}
                  isMoving={movingSkillId === skill.id}
                />
              )) : (
                <div className="col-span-full py-12 text-center text-sm text-slate-400">No core skills</div>
              )
            ) : (
              workspaceSkills.length > 0 ? workspaceSkills.map(skill => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  isCore={false}
                  coreUnlocked={coreUnlocked}
                  acting={acting || loading}
                  onRemove={() => void handleRemove(skill)}
                  onMoveToCore={() => void handleMoveToCore(skill)}
                  isRemoving={removingSkillId === skill.id}
                  isMoving={movingSkillId === skill.id}
                />
              )) : (
                <div className="col-span-full flex flex-col items-center justify-center py-24 bg-slate-50/50 dark:bg-slate-900/10 rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-800/50">
                  <Puzzle size={48} className="text-slate-200 dark:text-slate-800 mb-6" />
                  <p className="text-sm text-slate-400 dark:text-slate-600 max-w-xs text-center leading-relaxed font-bold">
                    {t('pixelOffice.drawer.skills.noSkills', 'No skills found')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleImport()}
                    disabled={acting}
                    className="mt-8 px-8 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-blue-500 shadow-sm hover:shadow-md transition-all active:scale-95"
                  >
                    {t('skillManager.actions.import', 'Import')}
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Security notice */}
      <div className="bg-gradient-to-br from-blue-600/5 to-indigo-600/5 border border-blue-500/10 p-8 rounded-[2.5rem] flex items-start gap-5">
        <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
          <Info size={24} />
        </div>
        <div>
          <h5 className="text-base font-black text-blue-600 dark:text-blue-400 tracking-tight">
            {t('skillManager.securityTitle', 'Security Note')}
          </h5>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed font-medium">
            {t('skillManager.securityDesc', 'Skills run with agent permissions. Only install trusted skills.')}
          </p>
        </div>
      </div>
    </div>
  );
}
