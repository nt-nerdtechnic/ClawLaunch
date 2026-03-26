import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, RefreshCw, FolderOpen, FileText, FileJson, ChevronRight,
  ChevronDown, AlertCircle, Loader2, Eye, Database,
  HardDrive, Clock, Search, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfigService } from '../services/configService';

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

  // ── Build group definitions from config ──────────────────────────────────

  const buildGroupDefs = useCallback((): Omit<MemoryGroup, 'files' | 'loading' | 'error' | 'exists'>[] => {
    const defs: Omit<MemoryGroup, 'files' | 'loading' | 'error' | 'exists'>[] = [];

    if (workspacePath) {
      // MEMORY may be a directory or a single .md file — try both
      defs.push({
        label: t('memory.groups.memory'),
        dirPath: `${workspacePath}/MEMORY`,
        singleFile: `${workspacePath}/MEMORY.md`,
        icon: <Brain size={15} />,
        accent: 'text-purple-400',
      });
      defs.push({
        label: t('memory.groups.bootstrap'),
        dirPath: `${workspacePath}/BOOTSTRAP`,
        singleFile: `${workspacePath}/BOOTSTRAP.md`,
        icon: <Database size={15} />,
        accent: 'text-emerald-400',
      });
      defs.push({
        label: t('memory.groups.identity'),
        dirPath: `${workspacePath}/IDENTITY`,
        singleFile: `${workspacePath}/IDENTITY.md`,
        icon: <HardDrive size={15} />,
        accent: 'text-sky-400',
      });
      defs.push({
        label: t('memory.groups.soul'),
        dirPath: `${workspacePath}/SOUL`,
        singleFile: `${workspacePath}/SOUL.md`,
        icon: <FileText size={15} />,
        accent: 'text-pink-400',
      });
      defs.push({
        label: t('memory.groups.user'),
        dirPath: `${workspacePath}/USER`,
        singleFile: `${workspacePath}/USER.md`,
        icon: <FileText size={15} />,
        accent: 'text-orange-400',
      });
      defs.push({
        label: t('memory.groups.heartbeat'),
        dirPath: `${workspacePath}/HEARTBEAT`,
        singleFile: `${workspacePath}/HEARTBEAT.md`,
        icon: <Clock size={15} />,
        accent: 'text-red-400',
      });
    }

    return defs;
  }, [workspacePath, t]);

  // ── Scan single directory ─────────────────────────────────────────────────

  const scanDir = useCallback(async (dirPath: string, singleFile?: string): Promise<{ exists: boolean; files: MemoryFile[]; error: string }> => {
    // If singleFile is provided: check it first; fall through to dir scan if missing
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
      // singleFile not found — fall through to directory check
    }

    try {
      // Check if directory exists
      const existRes = await window.electronAPI.exec(`test -d ${shellQuote(dirPath)} && echo EXISTS || echo MISSING`);
      if (existRes.code !== 0 || existRes.stdout.trim() !== 'EXISTS') {
        return { exists: false, files: [], error: '' };
      }

      // List files with stat info - name, size, modified
      const findCmd = `find ${shellQuote(dirPath)} -maxdepth 4 -type f \\( -name "*.md" -o -name "*.json" -o -name "*.txt" \\) 2>/dev/null | head -80`;
      const findRes = await window.electronAPI.exec(findCmd);
      const paths = findRes.stdout.trim().split('\n').filter(Boolean);
      if (paths.length === 0) return { exists: true, files: [], error: '' };

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

      // Sort: most-recently modified first
      files.sort((a, b) => b.modified.localeCompare(a.modified));

      return { exists: true, files, error: '' };
    } catch (e: any) {
      return { exists: false, files: [], error: e.message };
    }
  }, []);

  // ── Full scan ─────────────────────────────────────────────────────────────

  const runScan = useCallback(async () => {
    const defs = buildGroupDefs();
    if (defs.length === 0) return;

    setTotalScanning(true);
    // Initialize groups as loading
    setGroups(defs.map(d => ({ ...d, files: [], loading: true, error: '', exists: false })));

    const results = await Promise.all(
      defs.map(async (def) => {
        const { exists, files, error } = await scanDir(def.dirPath, def.singleFile);
        return { ...def, files, loading: false, error, exists };
      })
    );

    setGroups(results);
    // Auto-expand groups that exist and have files
    const toExpand = new Set(results.filter(g => g.exists && g.files.length > 0).map(g => g.dirPath));
    setExpandedGroups(toExpand);
    setLastScanAt(new Date().toLocaleTimeString());
    setTotalScanning(false);
  }, [buildGroupDefs, scanDir]);

  useEffect(() => {
    if (workspacePath || configPath) {
      runScan();
    }
  }, [workspacePath, configPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Read file content ─────────────────────────────────────────────────────

  const openFile = useCallback(async (file: MemoryFile) => {
    setSelectedFile(file);
    setFileContent('');
    setFileError('');
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
          {groups.map(group => {
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
                  <span className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 truncate">
                    {group.label}
                  </span>
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
                    {!group.loading && group.error && (
                      <div className="px-6 py-2 text-[11px] text-red-400 flex items-center gap-1">
                        <AlertCircle size={11} /> {group.error}
                      </div>
                    )}
                    {!group.loading && group.exists && filtered.length === 0 && (
                      <div className="px-6 py-2 text-[11px] text-slate-400 italic">
                        {searchQuery ? t('memory.noMatch') : t('memory.empty')}
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
          })}

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
              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                  <HardDrive size={10} /> {formatBytes(selectedFile.size)}
                </span>
                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                  <Clock size={10} /> {selectedFile.modified}
                </span>
                <button
                  type="button"
                  onClick={() => void window.electronAPI.exec(`open ${shellQuote(selectedFile.fullPath.replace(/\/[^/]+$/, ''))}`)}
                  className="text-[11px] text-slate-500 hover:text-blue-500 transition-colors flex items-center gap-1"
                  title={t('memory.revealInFinder')}
                >
                  <FolderOpen size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedFile(null); setFileContent(''); }}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-400"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              {fileLoading && (
                <div className="flex items-center justify-center h-40">
                  <Loader2 size={20} className="animate-spin text-slate-400" />
                </div>
              )}
              {!fileLoading && fileError && (
                <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-950/20 rounded-xl text-red-500 text-sm">
                  <AlertCircle size={16} />
                  {fileError}
                </div>
              )}
              {!fileLoading && !fileError && (
                <pre className={`text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-words ${
                  selectedFile.type === 'md'
                    ? 'text-slate-700 dark:text-slate-300'
                    : selectedFile.type === 'json'
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-slate-600 dark:text-slate-400'
                }`}>
                  {fileContent || <span className="text-slate-400 italic">{t('memory.emptyFile')}</span>}
                </pre>
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
