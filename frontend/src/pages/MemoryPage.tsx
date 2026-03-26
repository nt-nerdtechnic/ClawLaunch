import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, RefreshCw, FolderOpen, FileText, FileJson, ChevronRight,
  ChevronDown, AlertCircle, Loader2, Eye, Database,
  HardDrive, Clock, Search, X, Pencil, PencilOff, Save, Info, CalendarDays,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfigService } from '../services/configService';
import { CustomTooltip } from '../components/common/CustomTooltip';

// ── Types ──────────────────────────────────────────────────────────────────

interface MemoryFile {
  name: string;
  fullPath: string;
  size: number;
  modified: string;
  type: 'md' | 'json' | 'txt' | 'other';
}

interface MemoryGroup {
  label: string;
  dirPath: string;
  singleFile?: string; // if set, treat as a single file instead of a directory
  icon: React.ReactNode;
  accent: string;
  files: MemoryFile[];
  loading: boolean;
  error: string;
  exists: boolean;
  description: string;
  section: 'soul' | 'docs' | 'uncategorized';
}

interface MemoryPageProps {
  config: any;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const shellQuote = ConfigService.shellQuote;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileIcon(type: MemoryFile['type']) {
  if (type === 'json') return <FileJson size={14} className="text-amber-400" />;
  if (type === 'md') return <FileText size={14} className="text-blue-400" />;
  return <FileText size={14} className="text-slate-400" />;
}

function extToType(name: string): MemoryFile['type'] {
  if (name.endsWith('.md')) return 'md';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.txt')) return 'txt';
  return 'other';
}

// Dirs created by openclaw init that we already enumerate as named groups
const KNOWN_WORKSPACE_DIRS = new Set([
  'MEMORY', 'MEMORY_DAILY', 'BOOTSTRAP', 'IDENTITY', 'SOUL', 'USER', 'HEARTBEAT',
  'TOOLS', 'AGENTS', 'DOCUMENTS', 'ASSETS', 'CONTEXT', 'MODELS', 'SCRIPTS', 'DATA',
  'SKILLS', 'EXTENSIONS', 'AGENT',
]);

// ── MemoryPage ─────────────────────────────────────────────────────────────

export const MemoryPage: React.FC<MemoryPageProps> = ({ config }) => {
  const { t } = useTranslation();

  const workspacePath: string = config?.workspacePath || '';
  const configPath: string = config?.configPath || '';

  // groups of memory directories to scan
  const [groups, setGroups] = useState<MemoryGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [totalScanning, setTotalScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<string>('');

  // ── Edit state ───────────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Build group definitions from config ──────────────────────────────────

  const buildGroupDefs = useCallback((): Omit<MemoryGroup, 'files' | 'loading' | 'error' | 'exists'>[] => {
    const defs: Omit<MemoryGroup, 'files' | 'loading' | 'error' | 'exists'>[] = [];

    if (workspacePath) {
      // ── Soul Section ── Bootstrap 初始化順序 ──────────────────────────
      // 1. AGENTS.md - 工作區主說明書，Session 啟動規則
      defs.push({
        label: t('memory.groups.agents'),
        dirPath: `${workspacePath}/AGENTS`,
        singleFile: `${workspacePath}/AGENTS.md`,
        icon: <Brain size={15} />,
        accent: 'text-purple-400',
        description: t('memory.groupHints.agents'),
        section: 'soul',
      });
      // 2. SOUL.md - Agent 人格、行為準則
      defs.push({
        label: t('memory.groups.soul'),
        dirPath: `${workspacePath}/SOUL`,
        singleFile: `${workspacePath}/SOUL.md`,
        icon: <FileText size={15} />,
        accent: 'text-pink-400',
        description: t('memory.groupHints.soul'),
        section: 'soul',
      });
      // 3. IDENTITY.md - Agent 身份設定
      defs.push({
        label: t('memory.groups.identity'),
        dirPath: `${workspacePath}/IDENTITY`,
        singleFile: `${workspacePath}/IDENTITY.md`,
        icon: <HardDrive size={15} />,
        accent: 'text-sky-400',
        description: t('memory.groupHints.identity'),
        section: 'soul',
      });
      // 4. USER.md - 使用者資訊
      defs.push({
        label: t('memory.groups.user'),
        dirPath: `${workspacePath}/USER`,
        singleFile: `${workspacePath}/USER.md`,
        icon: <FileText size={15} />,
        accent: 'text-orange-400',
        description: t('memory.groupHints.user'),
        section: 'soul',
      });
      // 5. TOOLS.md - 可用工具清單
      defs.push({
        label: t('memory.groups.tools'),
        dirPath: `${workspacePath}/TOOLS`,
        singleFile: `${workspacePath}/TOOLS.md`,
        icon: <FileJson size={15} />,
        accent: 'text-amber-400',
        description: t('memory.groupHints.tools'),
        section: 'soul',
      });
      // 6. HEARTBEAT.md - 心跳/狀態追蹤
      defs.push({
        label: t('memory.groups.heartbeat'),
        dirPath: `${workspacePath}/HEARTBEAT`,
        singleFile: `${workspacePath}/HEARTBEAT.md`,
        icon: <Clock size={15} />,
        accent: 'text-red-400',
        description: t('memory.groupHints.heartbeat'),
        section: 'soul',
      });
      // 7. BOOTSTRAP.md - 首次啟動引導（讀完後刪除）
      defs.push({
        label: t('memory.groups.bootstrap'),
        dirPath: `${workspacePath}/BOOTSTRAP`,
        singleFile: `${workspacePath}/BOOTSTRAP.md`,
        icon: <Database size={15} />,
        accent: 'text-emerald-400',
        description: t('memory.groupHints.bootstrap'),
        section: 'soul',
      });
      // ── Memory Section ─────────────────────────────────────────────────
      // Long-term memory: single MEMORY.md file
      defs.push({
        label: t('memory.groups.memory'),
        dirPath: '',
        singleFile: `${workspacePath}/MEMORY.md`,
        icon: <Brain size={15} />,
        accent: 'text-purple-400',
        description: t('memory.groupHints.memory'),
        section: 'soul',
      });
      // Short-term / daily memory: memory/ directory
      defs.push({
        label: t('memory.groups.memoryDaily'),
        dirPath: `${workspacePath}/memory`,
        icon: <CalendarDays size={15} />,
        accent: 'text-violet-400',
        description: t('memory.groupHints.memoryDaily'),
        section: 'docs',
      });

      // ── Document Section ───────────────────────────────────────────────
      const docPath = `${workspacePath}/DOCUMENTS`;
      defs.push({
        label: t('memory.groups.documents'),
        dirPath: docPath,
        icon: <FolderOpen size={15} />,
        accent: 'text-blue-400',
        description: t('memory.groupHints.documents'),
        section: 'docs',
      });
      defs.push({
        label: t('memory.groups.assets'),
        dirPath: `${workspacePath}/ASSETS`,
        icon: <Database size={15} />,
        accent: 'text-indigo-400',
        description: t('memory.groupHints.assets'),
        section: 'docs',
      });
      defs.push({
        label: t('memory.groups.context'),
        dirPath: `${workspacePath}/CONTEXT`,
        icon: <FileText size={15} />,
        accent: 'text-cyan-400',
        description: t('memory.groupHints.context'),
        section: 'docs',
      });
      defs.push({
        label: t('memory.groups.models'),
        dirPath: `${workspacePath}/MODELS`,
        icon: <Database size={15} />,
        accent: 'text-teal-400',
        description: t('memory.groupHints.models'),
        section: 'docs',
      });
      defs.push({
        label: t('memory.groups.scripts'),
        dirPath: `${workspacePath}/SCRIPTS`,
        icon: <FileJson size={15} />,
        accent: 'text-amber-400',
        description: t('memory.groupHints.scripts'),
        section: 'docs',
      });
      defs.push({
        label: t('memory.groups.data'),
        dirPath: `${workspacePath}/DATA`,
        icon: <Database size={15} />,
        accent: 'text-slate-400',
        description: t('memory.groupHints.data'),
        section: 'docs',
      });
    }

    return defs;
  }, [workspacePath, t]);

  // ── Scan single directory ─────────────────────────────────────────────────

  const scanDir = useCallback(async (dirPath: string, singleFile?: string): Promise<{ exists: boolean; files: MemoryFile[]; error: string }> => {
    // Priority: directory scan first (may contain many files); singleFile is fallback only
    try {
      // Check if directory exists
      const existRes = await window.electronAPI.exec(`test -d ${shellQuote(dirPath)} && echo EXISTS || echo MISSING`);
      if (existRes.code === 0 && existRes.stdout.trim() === 'EXISTS') {
        // List files with stat info - name, size, modified
        const findCmd = `find ${shellQuote(dirPath)} -maxdepth 4 -type f \\( -name "*.md" -o -name "*.json" -o -name "*.txt" \\) 2>/dev/null | head -80`;
        const findRes = await window.electronAPI.exec(findCmd);
        const paths = findRes.stdout.trim().split('\n').filter(Boolean);

        if (paths.length > 0) {
          // Get stat for each file to retrieve size and modified time
          const statCmd = `stat -f '%z\t%Sm\t%N' -t '%Y-%m-%d %H:%M' ${paths.map(p => shellQuote(p)).join(' ')} 2>/dev/null`;
          const statRes = await window.electronAPI.exec(statCmd);
          const statLines = statRes.stdout.trim().split('\n').filter(Boolean);

          const files: MemoryFile[] = statLines.map((line) => {
            const parts = line.split('\t');
            const sz = parseInt(parts[0] || '0', 10);
            const mod = parts[1] || '';
            const fp = parts[2] || '';
            const name = fp.split('/').pop() || fp;
            return {
              name,
              fullPath: fp,
              size: isNaN(sz) ? 0 : sz,
              modified: mod,
              type: extToType(name),
            };
          }).filter(f => f.fullPath);

          files.sort((a, b) => b.modified.localeCompare(a.modified));
          return { exists: true, files, error: '' };
        }

        // Directory exists but empty — still mark exists
        return { exists: true, files: [], error: '' };
      }
    } catch (e: any) {
      return { exists: false, files: [], error: (e as Error).message };
    }

    // Directory not found — try singleFile as fallback
    if (singleFile) {
      const fileCheck = await window.electronAPI.exec(`test -f ${shellQuote(singleFile)} && echo EXISTS || echo MISSING`);
      if (fileCheck.code === 0 && fileCheck.stdout.trim() === 'EXISTS') {
        const statRes = await window.electronAPI.exec(`stat -f '%z\t%Sm\t%N' -t '%Y-%m-%d %H:%M' ${shellQuote(singleFile)} 2>/dev/null`);
        const line = statRes.stdout.trim();
        if (line) {
          const parts = line.split('\t');
          const sz = parseInt(parts[0] || '0', 10);
          const mod = parts[1] || '';
          const fp = parts[2] || singleFile;
          const name = fp.split('/').pop() || fp;
          return {
            exists: true,
            files: [{ name, fullPath: fp, size: isNaN(sz) ? 0 : sz, modified: mod, type: extToType(name) }],
            error: '',
          };
        }
      }
    }

    return { exists: false, files: [], error: '' };
  }, []);

  // ── Full scan ─────────────────────────────────────────────────────────────

  const runScan = useCallback(async () => {
    const defs = buildGroupDefs();
    if (defs.length === 0) return;

    setTotalScanning(true);
    // Initialize groups as loading
    setGroups(defs.map(d => ({ ...d, files: [], loading: true, error: '', exists: false, description: d.description || '', section: d.section })));

    const standardResults = await Promise.all(
      defs.map(async (def) => {
        const { exists, files, error } = await scanDir(def.dirPath, def.singleFile);
        return { ...def, files, loading: false, error, exists };
      })
    );

    // ── Scan for uncategorized top-level dirs ──────────────────────────────
    const uncategorizedResults: MemoryGroup[] = [];
    if (workspacePath) {
      const listRes = await window.electronAPI.exec(
        `find ${shellQuote(workspacePath)} -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort`
      );
      const extraDirs = listRes.stdout.trim().split('\n').filter(Boolean).filter(d => {
        const name = d.split('/').pop() || '';
        return !KNOWN_WORKSPACE_DIRS.has(name.toUpperCase()) && !name.startsWith('.');
      });
      for (const dirPath of extraDirs) {
        const { exists, files, error } = await scanDir(dirPath);
        if (exists && files.length > 0) {
          const name = dirPath.split('/').pop() || dirPath;
          uncategorizedResults.push({
            label: name,
            dirPath,
            icon: <FolderOpen size={15} />,
            accent: 'text-slate-400',
            description: name,
            section: 'uncategorized',
            files,
            loading: false,
            error,
            exists,
          });
        }
      }
    }

    setGroups([...standardResults, ...uncategorizedResults]);
    setLastScanAt(new Date().toLocaleTimeString());
    setTotalScanning(false);
  }, [buildGroupDefs, scanDir, workspacePath]);

  useEffect(() => {
    if (workspacePath || configPath) {
      runScan();
    }
  }, [workspacePath, configPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save file content ─────────────────────────────────────────────────────

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      const res = await window.electronAPI.writeFile(selectedFile.fullPath, editContent);
      if (res.success) {
        setFileContent(editContent);
        setIsEditing(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        // refresh size shown in sidebar by triggering a re-scan
        runScan();
      } else {
        setSaveError(res.error || t('memory.errors.saveFailed'));
      }
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setIsSaving(false);
    }
  }, [selectedFile, editContent, t, runScan]);

  const enterEditMode = useCallback(() => {
    setEditContent(fileContent);
    setSaveError('');
    setSaveSuccess(false);
    setIsEditing(true);
  }, [fileContent]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setSaveError('');
  }, []);

  // ── Read file content ─────────────────────────────────────────────────────

  const openFile = useCallback(async (file: MemoryFile) => {
    setSelectedFile(file);
    setFileContent('');
    setFileError('');
    setIsEditing(false);
    setSaveError('');
    setFileLoading(true);
    try {
      const res = await window.electronAPI.exec(`cat ${shellQuote(file.fullPath)} 2>/dev/null`);
      if (res.code === 0) {
        setFileContent(res.stdout);
      } else {
        setFileError(res.stderr || t('memory.errors.readFailed'));
      }
    } catch (e: any) {
      setFileError(e.message);
    } finally {
      setFileLoading(false);
    }
  }, [t]);

  // ── Filter files by search ────────────────────────────────────────────────

  const filterFiles = (files: MemoryFile[]) => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q) || f.fullPath.toLowerCase().includes(q));
  };

  // ── Toggle expand group ───────────────────────────────────────────────────

  const toggleGroup = (dirPath: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const renderGroup = (group: MemoryGroup) => {
    const filtered = filterFiles(group.files);
    const isExpanded = expandedGroups.has(group.dirPath);

    return (
      <div key={group.dirPath} className="border-b border-slate-100 dark:border-slate-800/50 last:border-0">
        {/* Group header */}
        <button
          type="button"
          onClick={() => toggleGroup(group.dirPath)}
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors text-left"
        >
          {isExpanded
            ? <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
            : <ChevronRight size={12} className="text-slate-400 flex-shrink-0" />
          }
          <span className={`flex-shrink-0 ${group.accent}`}>{group.icon}</span>
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 truncate">
              {group.label}
            </span>
            <CustomTooltip content={group.description} delay={0.1}>
              <span 
                className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-help transition-colors flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Info size={13} />
              </span>
            </CustomTooltip>
          </div>
          <span className="text-[10px] font-mono text-slate-400 ml-auto flex-shrink-0">
            {group.loading
              ? <Loader2 size={10} className="animate-spin" />
              : group.exists
                ? group.files.length
                : '—'
            }
          </span>
        </button>

        {/* Files list */}
        {isExpanded && (
          <div className="pb-1">
            {group.loading && (
              <div className="px-6 py-2">
                <Loader2 size={13} className="animate-spin text-slate-400 mx-auto" />
              </div>
            )}
            {!group.loading && !group.exists && (
              <div className="px-6 py-2 text-[11px] text-slate-400 italic">{t('memory.dirNotFound')}</div>
            )}
            {!group.loading && group.exists && filtered.length === 0 && (
              <div className="px-6 py-2 text-[11px] text-slate-400 italic">
                {group.files.length === 0 ? t('memory.empty') : t('memory.noMatch')}
              </div>
            )}
            {!group.loading && filtered.map(file => (
              <button
                key={file.fullPath}
                type="button"
                onClick={() => openFile(file)}
                className={`w-full flex items-center gap-2 px-6 py-2 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors text-left group ${
                  selectedFile?.fullPath === file.fullPath
                    ? 'bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-500'
                    : 'border-l-2 border-transparent'
                }`}
              >
                <span className="flex-shrink-0">{fileIcon(file.type)}</span>
                <span className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate font-medium">
                  {file.name}
                </span>
                <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {formatBytes(file.size)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Total stats ───────────────────────────────────────────────────────────

  const totalFiles = groups.reduce((n, g) => n + g.files.length, 0);
  const totalSize = groups.reduce((n, g) => n + g.files.reduce((s, f) => s + f.size, 0), 0);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!workspacePath && !configPath) {
    return (
      <div className="flex-1 flex items-center justify-center p-12 animate-in fade-in duration-500">
        <div className="text-center space-y-3">
          <Brain size={40} className="mx-auto text-slate-400 opacity-50" />
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">{t('memory.noWorkspace')}</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs">{t('memory.noWorkspaceHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden animate-in fade-in duration-500">
      {/* Left panel - file browser */}
      <div className="w-80 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            <Brain size={15} className="text-purple-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('memory.browser')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {lastScanAt && (
              <span className="text-[10px] text-slate-400 font-mono">{lastScanAt}</span>
            )}
            <button
              type="button"
              onClick={runScan}
              disabled={totalScanning}
              className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors disabled:opacity-50"
              title={t('memory.refresh')}
            >
              <RefreshCw size={13} className={totalScanning ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-4 py-2 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800 flex gap-4">
          <div className="flex items-center gap-1.5">
            <FileText size={11} className="text-slate-400" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{totalFiles} {t('memory.files')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive size={11} className="text-slate-400" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{formatBytes(totalSize)}</span>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <Search size={12} className="text-slate-400 flex-shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('memory.searchPlaceholder')}
              className="flex-1 bg-transparent text-xs text-slate-700 dark:text-slate-200 outline-none placeholder:text-slate-400"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto pb-4">
          {/* Soul Section — always show all core groups */}
          {(() => {
            const soulGroups = groups.filter(g => g.section === 'soul');
            if (soulGroups.length === 0 && !totalScanning) return null;
            return (
              <>
                <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100 dark:border-slate-800/50 sticky top-0 z-10 backdrop-blur-sm">
                  {t('memory.sections.soul')}
                </div>
                {soulGroups.map(renderGroup)}
              </>
            );
          })()}

          {/* Document Section — only visible groups */}
          {(() => {
            const docsGroups = groups.filter(g => g.section === 'docs' && (g.loading || g.exists));
            if (docsGroups.length === 0 && !totalScanning) return null;
            return (
              <>
                <div className="px-4 py-2 mt-4 bg-slate-50/80 dark:bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-t border-b border-slate-100 dark:border-slate-800/50 sticky top-0 z-10 backdrop-blur-sm">
                  {t('memory.sections.docs')}
                </div>
                {docsGroups.map(renderGroup)}
              </>
            );
          })()}

          {/* Uncategorized Section — extra dirs found in workspace */}
          {(() => {
            const uncatGroups = groups.filter(g => g.section === 'uncategorized');
            if (uncatGroups.length === 0) return null;
            return (
              <>
                <div className="px-4 py-2 mt-4 bg-slate-50/80 dark:bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-t border-b border-slate-100 dark:border-slate-800/50 sticky top-0 z-10 backdrop-blur-sm">
                  {t('memory.sections.uncategorized')}
                </div>
                {uncatGroups.map(renderGroup)}
              </>
            );
          })()}

          {!totalScanning && groups.length === 0 && (
            <div className="p-6 text-center">
              <Brain size={24} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-xs text-slate-400">{t('memory.noGroups')}</p>
            </div>
          )}
        </div>

        {/* Workspace path hint */}
        {workspacePath && (
          <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <div className="flex items-center gap-1.5 group cursor-default" title={workspacePath}>
              <FolderOpen size={10} className="text-slate-400 flex-shrink-0" />
              <span className="text-[10px] text-slate-400 font-mono truncate">{workspacePath}</span>
            </div>
          </div>
        )}
      </div>

      {/* Right panel - file viewer */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-950">
        {selectedFile ? (
          <>
            {/* File header */}
            <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {fileIcon(selectedFile.type)}
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{selectedFile.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">{selectedFile.fullPath}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                  <HardDrive size={10} /> {formatBytes(selectedFile.size)}
                </span>
                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                  <Clock size={10} /> {selectedFile.modified}
                </span>
                <button
                  type="button"
                  onClick={() => void window.electronAPI.exec(`open ${shellQuote(selectedFile.fullPath.replace(/\/[^/]+$/, ''))}`)}
                  className="p-1 text-slate-500 hover:text-blue-500 transition-colors rounded"
                  title={t('memory.revealInFinder')}
                >
                  <FolderOpen size={12} />
                </button>

                {/* Edit toggle — only for .md and .txt files */}
                {(selectedFile.type === 'md' || selectedFile.type === 'txt') && !isEditing && (
                  <button
                    type="button"
                    onClick={enterEditMode}
                    disabled={fileLoading}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40"
                    title={t('memory.edit')}
                  >
                    <Pencil size={11} />
                    <span>{t('memory.edit')}</span>
                  </button>
                )}

                {isEditing && (
                  <>
                    <button
                      type="button"
                      onClick={saveFile}
                      disabled={isSaving}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                    >
                      {isSaving
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Save size={11} />}
                      <span>{isSaving ? t('memory.saving') : t('memory.save')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-500 hover:text-red-500 transition-colors"
                    >
                      <PencilOff size={11} />
                      <span>{t('memory.cancelEdit')}</span>
                    </button>
                  </>
                )}

                {saveSuccess && !isEditing && (
                  <span className="text-[11px] text-emerald-500 font-medium animate-in fade-in duration-300">{t('memory.saved')}</span>
                )}

                <button
                  type="button"
                  onClick={() => { setSelectedFile(null); setFileContent(''); setIsEditing(false); }}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-400"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto flex flex-col">
              {fileLoading && (
                <div className="flex items-center justify-center h-40">
                  <Loader2 size={20} className="animate-spin text-slate-400" />
                </div>
              )}
              {!fileLoading && fileError && (
                <div className="m-6 flex items-center gap-2 p-4 bg-red-50 dark:bg-red-950/20 rounded-xl text-red-500 text-sm">
                  <AlertCircle size={16} />
                  {fileError}
                </div>
              )}
              {!fileLoading && saveError && (
                <div className="mx-6 mt-4 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-xl text-red-500 text-xs">
                  <AlertCircle size={13} />
                  {saveError}
                </div>
              )}
              {!fileLoading && !fileError && !isEditing && (
                <div className="p-6">
                  <pre className={`text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-words ${
                    selectedFile.type === 'md'
                      ? 'text-slate-700 dark:text-slate-300'
                      : selectedFile.type === 'json'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-slate-600 dark:text-slate-400'
                  }`}>
                    {fileContent || <span className="text-slate-400 italic">{t('memory.emptyFile')}</span>}
                  </pre>
                </div>
              )}
              {!fileLoading && !fileError && isEditing && (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full h-full min-h-[400px] p-6 text-[12px] leading-relaxed font-mono bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 resize-none outline-none border-0 focus:ring-0"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Eye size={36} className="mx-auto text-slate-200 dark:text-slate-700" />
              <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">{t('memory.selectFile')}</p>
              <p className="text-xs text-slate-300 dark:text-slate-600">{t('memory.selectFileHint')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
