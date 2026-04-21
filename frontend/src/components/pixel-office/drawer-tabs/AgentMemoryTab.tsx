import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Brain, FileText, FileJson, FolderOpen, Loader2, AlertCircle,
  RefreshCw, ChevronRight, ChevronDown, X, Pencil, PencilOff,
  Save, HardDrive, Clock, Search, Eye, FileCode, Settings2,
  Image as ImageIcon, Trash2, Database, CalendarDays, Info,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CustomTooltip } from '../../common/CustomTooltip';

// ── Types ──────────────────────────────────────────────────────────────────

interface MemoryFile {
  name: string;
  fullPath: string;
  size: number;
  modified: string;
  type: 'md' | 'json' | 'txt' | 'code' | 'config' | 'image' | 'other';
}

interface MemoryGroup {
  label: string;
  dirPath: string;
  singleFile?: string;
  icon: React.ReactNode;
  accent: string;
  files: MemoryFile[];
  loading: boolean;
  error: string;
  exists: boolean;
  description: string;
  section: 'soul' | 'docs' | 'uncategorized' | 'images';
}

interface AgentMemoryTabProps {
  agentWorkspace?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const sq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extToType(name: string): MemoryFile['type'] {
  const n = name.toLowerCase();
  const dotIdx = n.lastIndexOf('.');
  const ext = dotIdx > 0 ? n.slice(dotIdx) : (n.startsWith('.') ? n : '');

  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'md';
  if (ext === '.json' || ext === '.jsonl' || ext === '.json5' || ext === '.geojson') return 'json';
  if (['.txt', '.log', '.out', '.err', '.csv', '.tsv', '.diff', '.patch'].includes(ext)) return 'txt';

  if ([
    '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg', '.xml', '.plist',
    '.properties', '.env', '.env.local', '.env.example', '.env.production',
    '.gitignore', '.gitattributes', '.gitmodules', '.npmrc', '.nvmrc', '.yarnrc',
    '.prettierrc', '.eslintrc', '.eslintignore', '.babelrc', '.stylelintrc',
    '.editorconfig', '.dockerignore', '.htaccess', '.netrc',
  ].includes(ext)) return 'config';

  if (ext === '') {
    const base = n;
    if (['makefile', 'dockerfile', 'containerfile', 'vagrantfile', 'brewfile',
         'gemfile', 'podfile', 'fastfile', 'procfile', 'rakefile', 'guardfile',
         'gruntfile', 'gulpfile'].includes(base)) return 'code';
    if (['readme', 'license', 'licence', 'changelog', 'notice', 'authors',
         'contributors', 'copying', 'todo', 'notes', 'history'].includes(base)) return 'txt';
    return 'other';
  }

  if (['.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.tcsh', '.ps1', '.bat', '.cmd'].includes(ext)) return 'code';
  if (['.py', '.pyw', '.pyi', '.pyx', '.pxd'].includes(ext)) return 'code';
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
       '.vue', '.svelte', '.astro', '.html', '.htm', '.css', '.scss', '.sass', '.less'].includes(ext)) return 'code';
  if (['.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx',
       '.m', '.mm', '.swift', '.go', '.rs', '.zig',
       '.java', '.kt', '.kts', '.groovy', '.scala', '.clj', '.cljs',
       '.cs', '.vb', '.fs', '.fsi', '.fsx'].includes(ext)) return 'code';
  if (['.rb', '.rake', '.gemspec', '.lua', '.pl', '.pm',
       '.php', '.php3', '.php4', '.php5', '.phtml',
       '.r', '.rmd', '.jl', '.ex', '.exs', '.erl', '.hrl',
       '.hs', '.lhs', '.elm', '.dart', '.cr', '.nim',
       '.tcl', '.awk', '.sed'].includes(ext)) return 'code';
  if (['.sql', '.graphql', '.gql', '.proto', '.thrift', '.avsc'].includes(ext)) return 'code';
  if (['.tf', '.tfvars', '.hcl', '.nomad', '.pkr'].includes(ext)) return 'config';
  if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp',
       '.ico', '.icns', '.svg'].includes(ext)) return 'image';

  return 'other';
}

function fileIcon(type: MemoryFile['type']) {
  if (type === 'json') return <FileJson size={14} className="text-amber-400" />;
  if (type === 'md') return <FileText size={14} className="text-blue-400" />;
  if (type === 'code') return <FileCode size={14} className="text-orange-400" />;
  if (type === 'config') return <Settings2 size={14} className="text-emerald-400" />;
  if (type === 'image') return <Eye size={14} className="text-pink-400" />;
  if (type === 'txt') return <FileText size={14} className="text-slate-400" />;
  return <FileText size={14} className="text-slate-300 dark:text-slate-600" />;
}

const KNOWN_WORKSPACE_DIRS = new Set([
  'MEMORY', 'MEMORY_DAILY', 'BOOTSTRAP', 'IDENTITY', 'SOUL', 'USER', 'HEARTBEAT',
  'TOOLS', 'AGENTS', 'DOCUMENTS', 'ASSETS', 'CONTEXT', 'MODELS', 'SCRIPTS', 'DATA',
  'SKILLS', 'EXTENSIONS', 'AGENT',
]);

const ENCODING_GROUPS: { label: string; options: { value: string; label: string }[] }[] = [
  {
    label: 'Unicode',
    options: [
      { value: 'utf-8',    label: 'UTF-8' },
      { value: 'utf-16le', label: 'UTF-16 LE' },
      { value: 'utf-16be', label: 'UTF-16 BE' },
      { value: 'utf-32le', label: 'UTF-32 LE' },
      { value: 'utf-32be', label: 'UTF-32 BE' },
    ],
  },
  {
    label: '中文',
    options: [
      { value: 'gb18030',    label: 'GB18030 / GBK (简体)' },
      { value: 'big5',       label: 'Big5 (繁體)' },
      { value: 'big5-hkscs', label: 'Big5-HKSCS (香港)' },
      { value: 'hz-gb-2312', label: 'HZ-GB-2312' },
    ],
  },
  {
    label: '日本語',
    options: [
      { value: 'shift-jis',   label: 'Shift-JIS (SJIS)' },
      { value: 'euc-jp',      label: 'EUC-JP' },
      { value: 'iso-2022-jp', label: 'ISO-2022-JP (JIS)' },
    ],
  },
  {
    label: '한국어',
    options: [
      { value: 'euc-kr',      label: 'EUC-KR' },
      { value: 'iso-2022-kr', label: 'ISO-2022-KR' },
    ],
  },
  {
    label: 'Cyrillic',
    options: [
      { value: 'windows-1251', label: 'Windows-1251' },
      { value: 'koi8-r',       label: 'KOI8-R' },
      { value: 'koi8-u',       label: 'KOI8-U' },
      { value: 'iso-8859-5',   label: 'ISO-8859-5' },
    ],
  },
  {
    label: 'Western European',
    options: [
      { value: 'windows-1252', label: 'Windows-1252 (CP1252)' },
      { value: 'iso-8859-1',   label: 'ISO-8859-1 (Latin-1)' },
      { value: 'iso-8859-2',   label: 'ISO-8859-2 (Central EU)' },
      { value: 'iso-8859-3',   label: 'ISO-8859-3 (South EU)' },
      { value: 'iso-8859-4',   label: 'ISO-8859-4 (North EU)' },
      { value: 'iso-8859-15',  label: 'ISO-8859-15 (Latin-9)' },
      { value: 'windows-1250', label: 'Windows-1250 (Central EU)' },
    ],
  },
  {
    label: 'Other',
    options: [
      { value: 'windows-1254', label: 'Windows-1254 (Turkish)' },
      { value: 'windows-1255', label: 'Windows-1255 (Hebrew)' },
      { value: 'windows-1256', label: 'Windows-1256 (Arabic)' },
      { value: 'windows-1257', label: 'Windows-1257 (Baltic)' },
      { value: 'iso-8859-6',   label: 'ISO-8859-6 (Arabic)' },
      { value: 'iso-8859-7',   label: 'ISO-8859-7 (Greek)' },
      { value: 'iso-8859-8',   label: 'ISO-8859-8 (Hebrew)' },
      { value: 'iso-8859-9',   label: 'ISO-8859-9 (Turkish)' },
      { value: 'tis-620',      label: 'TIS-620 (Thai)' },
      { value: 'ibm866',       label: 'IBM-866 (DOS Cyrillic)' },
    ],
  },
];

const ALL_ENCODINGS = ENCODING_GROUPS.flatMap(g => g.options);

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'ico', 'icns', 'svg', 'avif', 'heic'];

// ── Skeleton ────────────────────────────────────────────────────────────────

const SkeletonBrowserItem: React.FC<{ variant?: 'group' | 'file' }> = ({ variant = 'group' }) => (
  <div className={`w-full flex items-center gap-2 px-3 py-2 animate-pulse ${variant === 'file' ? 'pl-8 py-1.5' : 'py-2.5'}`}>
    <div className={`flex-shrink-0 bg-slate-100 dark:bg-slate-800 rounded ${variant === 'group' ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} />
    <div className="flex-1 space-y-1.5">
      <div className={`bg-slate-100 dark:bg-slate-800 rounded ${variant === 'group' ? 'h-3 w-1/2' : 'h-2.5 w-3/4'}`} />
    </div>
    {variant === 'group' && <div className="w-4 h-2.5 bg-slate-100/50 dark:bg-slate-800/50 rounded ml-auto" />}
  </div>
);

// ── Component ──────────────────────────────────────────────────────────────

export default function AgentMemoryTab({ agentWorkspace }: AgentMemoryTabProps) {
  const { t } = useTranslation();

  const [groups, setGroups] = useState<MemoryGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [totalScanning, setTotalScanning] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastScanAt, setLastScanAt] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [encoding, setEncoding] = useState('utf-8');
  const [showEncodingMenu, setShowEncodingMenu] = useState(false);
  const [encodingAutoDetected, setEncodingAutoDetected] = useState(false);
  const [isBinaryFile, setIsBinaryFile] = useState(false);
  const [isImageFile, setIsImageFile] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [imgDeleteConfirm, setImgDeleteConfirm] = useState<string | null>(null);
  const [imgDeleting, setImgDeleting] = useState<string | null>(null);

  // ── scanDir ────────────────────────────────────────────────────────────────

  const scanDir = useCallback(async (
    dirPath: string, singleFile?: string
  ): Promise<{ exists: boolean; files: MemoryFile[]; error: string }> => {
    try {
      const existRes = await window.electronAPI.exec(`test -d ${sq(dirPath)} && echo EXISTS || echo MISSING`);
      if (existRes.code === 0 && existRes.stdout.trim() === 'EXISTS') {
        const findCmd = [
          `find ${sq(dirPath)} -maxdepth 4 -type f`,
          `! -path "*/.git/*" ! -path "*/node_modules/*" ! -path "*/__pycache__/*"`,
          `! -name ".DS_Store" ! -name "*.DS_Store" ! -name "Thumbs.db"`,
          `! -name "*.woff" ! -name "*.woff2" ! -name "*.ttf" ! -name "*.otf" ! -name "*.eot"`,
          `! -name "*.mp4" ! -name "*.avi" ! -name "*.mov" ! -name "*.mkv" ! -name "*.wmv" ! -name "*.flv"`,
          `! -name "*.mp3" ! -name "*.wav" ! -name "*.flac" ! -name "*.aac" ! -name "*.ogg" ! -name "*.m4a"`,
          `! -name "*.zip" ! -name "*.tar" ! -name "*.gz" ! -name "*.bz2" ! -name "*.xz" ! -name "*.7z" ! -name "*.rar" ! -name "*.zst"`,
          `! -name "*.pdf" ! -name "*.doc" ! -name "*.docx" ! -name "*.xls" ! -name "*.xlsx" ! -name "*.ppt" ! -name "*.pptx"`,
          `! -name "*.exe" ! -name "*.dll" ! -name "*.so" ! -name "*.dylib" ! -name "*.bin"`,
          `! -name "*.o" ! -name "*.a" ! -name "*.obj" ! -name "*.lib"`,
          `! -name "*.pyc" ! -name "*.pyo" ! -name "*.class" ! -name "*.jar"`,
          `! -name "*.db" ! -name "*.sqlite" ! -name "*.sqlite3"`,
          `2>/dev/null | head -200`,
        ].join(' ');
        const findRes = await window.electronAPI.exec(findCmd);
        const paths = findRes.stdout.trim().split('\n').filter(Boolean);
        if (paths.length > 0) {
          const statRes = await window.electronAPI.exec(
            `stat -f '%z\t%Sm\t%N' -t '%Y-%m-%d %H:%M' ${paths.map(p => sq(p)).join(' ')} 2>/dev/null`
          );
          const files: MemoryFile[] = statRes.stdout.trim().split('\n').filter(Boolean).map(line => {
            const parts = line.split('\t');
            const sz = parseInt(parts[0] || '0', 10);
            const fp = parts[2] || '';
            const name = fp.split('/').pop() || fp;
            return { name, fullPath: fp, size: isNaN(sz) ? 0 : sz, modified: parts[1] || '', type: extToType(name) };
          }).filter(f => f.fullPath);
          files.sort((a, b) => b.modified.localeCompare(a.modified));
          return { exists: true, files, error: '' };
        }
        return { exists: true, files: [], error: '' };
      }
    } catch (e) {
      return { exists: false, files: [], error: String(e) };
    }

    if (singleFile) {
      const check = await window.electronAPI.exec(`test -f ${sq(singleFile)} && echo EXISTS || echo MISSING`);
      if (check.code === 0 && check.stdout.trim() === 'EXISTS') {
        const statRes = await window.electronAPI.exec(
          `stat -f '%z\t%Sm\t%N' -t '%Y-%m-%d %H:%M' ${sq(singleFile)} 2>/dev/null`
        );
        const line = statRes.stdout.trim();
        if (line) {
          const parts = line.split('\t');
          const sz = parseInt(parts[0] || '0', 10);
          const fp = parts[2] || singleFile;
          const name = fp.split('/').pop() || fp;
          return { exists: true, files: [{ name, fullPath: fp, size: isNaN(sz) ? 0 : sz, modified: parts[1] || '', type: extToType(name) }], error: '' };
        }
      }
    }
    return { exists: false, files: [], error: '' };
  }, []);

  // ── scanImageGroups ────────────────────────────────────────────────────────

  const scanImageGroups = useCallback(async (): Promise<MemoryGroup[]> => {
    if (!agentWorkspace) return [];
    try {
      const nameChecks = IMAGE_EXTS.map(e => `-iname "*.${e}"`).join(' -o ');
      const findCmd = [
        `find ${sq(agentWorkspace)} -maxdepth 6 -type f \\( ${nameChecks} \\)`,
        `! -path "*/.git/*" ! -path "*/node_modules/*" ! -name ".DS_Store" 2>/dev/null | head -400`,
      ].join(' ');
      const findRes = await window.electronAPI.exec(findCmd);
      const paths = findRes.stdout.trim().split('\n').filter(Boolean);
      if (paths.length === 0) return [];
      const statRes = await window.electronAPI.exec(
        `stat -f '%z\t%Sm\t%N' -t '%Y-%m-%d %H:%M' ${paths.map(p => sq(p)).join(' ')} 2>/dev/null`
      );
      const allFiles: MemoryFile[] = statRes.stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        const sz = parseInt(parts[0] || '0', 10);
        const fp = parts[2] || '';
        const name = fp.split('/').pop() || fp;
        return { name, fullPath: fp, size: isNaN(sz) ? 0 : sz, modified: parts[1] || '', type: 'image' as const };
      }).filter(f => f.fullPath);

      const byDir = new Map<string, MemoryFile[]>();
      for (const file of allFiles) {
        const dir = file.fullPath.split('/').slice(0, -1).join('/');
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir)!.push(file);
      }

      const result: MemoryGroup[] = [];
      for (const [dirPath, dirFiles] of byDir) {
        dirFiles.sort((a, b) => a.name.localeCompare(b.name));
        const rel = dirPath.startsWith(agentWorkspace + '/')
          ? dirPath.slice(agentWorkspace.length + 1)
          : (dirPath.split('/').pop() || dirPath);
        result.push({ label: rel, dirPath: `__img__:${dirPath}`, icon: <ImageIcon size={15} />, accent: 'text-pink-400', description: dirPath, section: 'images', files: dirFiles, loading: false, error: '', exists: true });
      }
      result.sort((a, b) => a.label.localeCompare(b.label));
      return result;
    } catch { return []; }
  }, [agentWorkspace]);

  // ── buildGroupDefs ─────────────────────────────────────────────────────────

  const buildGroupDefs = useCallback((): Omit<MemoryGroup, 'files' | 'loading' | 'error' | 'exists'>[] => {
    if (!agentWorkspace) return [];
    const ws = agentWorkspace;
    return [
      { label: t('memory.groups.agents', 'AGENTS'), dirPath: `${ws}/AGENTS`, singleFile: `${ws}/AGENTS.md`, icon: <Brain size={15} />, accent: 'text-purple-400', description: t('memory.groupHints.agents', 'Agent rules'), section: 'soul' as const },
      { label: t('memory.groups.soul', 'SOUL'), dirPath: `${ws}/SOUL`, singleFile: `${ws}/SOUL.md`, icon: <FileText size={15} />, accent: 'text-pink-400', description: t('memory.groupHints.soul', 'Personality'), section: 'soul' as const },
      { label: t('memory.groups.identity', 'IDENTITY'), dirPath: `${ws}/IDENTITY`, singleFile: `${ws}/IDENTITY.md`, icon: <HardDrive size={15} />, accent: 'text-sky-400', description: t('memory.groupHints.identity', 'Identity'), section: 'soul' as const },
      { label: t('memory.groups.user', 'USER'), dirPath: `${ws}/USER`, singleFile: `${ws}/USER.md`, icon: <FileText size={15} />, accent: 'text-orange-400', description: t('memory.groupHints.user', 'User info'), section: 'soul' as const },
      { label: t('memory.groups.tools', 'TOOLS'), dirPath: `${ws}/TOOLS`, singleFile: `${ws}/TOOLS.md`, icon: <FileJson size={15} />, accent: 'text-amber-400', description: t('memory.groupHints.tools', 'Tools'), section: 'soul' as const },
      { label: t('memory.groups.heartbeat', 'HEARTBEAT'), dirPath: `${ws}/HEARTBEAT`, singleFile: `${ws}/HEARTBEAT.md`, icon: <Clock size={15} />, accent: 'text-red-400', description: t('memory.groupHints.heartbeat', 'Heartbeat'), section: 'soul' as const },
      { label: t('memory.groups.bootstrap', 'BOOTSTRAP'), dirPath: `${ws}/BOOTSTRAP`, singleFile: `${ws}/BOOTSTRAP.md`, icon: <Database size={15} />, accent: 'text-emerald-400', description: t('memory.groupHints.bootstrap', 'Bootstrap'), section: 'soul' as const },
      { label: t('memory.groups.memory', 'MEMORY'), dirPath: '', singleFile: `${ws}/MEMORY.md`, icon: <Brain size={15} />, accent: 'text-purple-400', description: t('memory.groupHints.memory', 'Long-term memory'), section: 'soul' as const },
      { label: t('memory.groups.memoryDaily', 'MEMORY Daily'), dirPath: `${ws}/memory`, icon: <CalendarDays size={15} />, accent: 'text-violet-400', description: t('memory.groupHints.memoryDaily', 'Daily memory'), section: 'docs' as const },
      { label: t('memory.groups.documents', 'DOCUMENTS'), dirPath: `${ws}/DOCUMENTS`, icon: <FolderOpen size={15} />, accent: 'text-blue-400', description: t('memory.groupHints.documents', 'Documents'), section: 'docs' as const },
      { label: t('memory.groups.assets', 'ASSETS'), dirPath: `${ws}/ASSETS`, icon: <Database size={15} />, accent: 'text-indigo-400', description: t('memory.groupHints.assets', 'Assets'), section: 'docs' as const },
      { label: t('memory.groups.context', 'CONTEXT'), dirPath: `${ws}/CONTEXT`, icon: <FileText size={15} />, accent: 'text-cyan-400', description: t('memory.groupHints.context', 'Context'), section: 'docs' as const },
      { label: t('memory.groups.models', 'MODELS'), dirPath: `${ws}/MODELS`, icon: <Database size={15} />, accent: 'text-teal-400', description: t('memory.groupHints.models', 'Models'), section: 'docs' as const },
      { label: t('memory.groups.scripts', 'SCRIPTS'), dirPath: `${ws}/SCRIPTS`, icon: <FileJson size={15} />, accent: 'text-amber-400', description: t('memory.groupHints.scripts', 'Scripts'), section: 'docs' as const },
      { label: t('memory.groups.data', 'DATA'), dirPath: `${ws}/DATA`, icon: <Database size={15} />, accent: 'text-slate-400', description: t('memory.groupHints.data', 'Data'), section: 'docs' as const },
    ];
  }, [agentWorkspace, t]);

  // ── runScan ────────────────────────────────────────────────────────────────

  const runScan = useCallback(async () => {
    if (!agentWorkspace) return;
    const defs = buildGroupDefs();
    if (defs.length === 0) return;
    setTotalScanning(true);
    setGroups(defs.map(d => ({ ...d, files: [], loading: true, error: '', exists: false })));

    const standardResults = await Promise.all(
      defs.map(async def => {
        const { exists, files, error } = await scanDir(def.dirPath, def.singleFile);
        return { ...def, files, loading: false, error, exists };
      })
    );

    const uncategorizedResults: MemoryGroup[] = [];
    const listRes = await window.electronAPI.exec(
      `find ${sq(agentWorkspace)} -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort`
    );
    const extraDirs = listRes.stdout.trim().split('\n').filter(Boolean).filter(d => {
      const name = d.split('/').pop() || '';
      return !KNOWN_WORKSPACE_DIRS.has(name.toUpperCase()) && !name.startsWith('.');
    });
    for (const dirPath of extraDirs) {
      const { exists, files, error } = await scanDir(dirPath);
      if (exists && files.length > 0) {
        const name = dirPath.split('/').pop() || dirPath;
        uncategorizedResults.push({ label: name, dirPath, icon: <FolderOpen size={15} />, accent: 'text-slate-400', description: name, section: 'uncategorized', files, loading: false, error, exists });
      }
    }

    const imageGroupResults = await scanImageGroups();
    setGroups([...standardResults, ...uncategorizedResults, ...imageGroupResults]);
    setLastScanAt(new Date().toLocaleTimeString());
    setTotalScanning(false);
    setInitialLoading(false);
  }, [agentWorkspace, buildGroupDefs, scanDir, scanImageGroups]);

  useEffect(() => { if (agentWorkspace) void runScan(); }, [agentWorkspace, runScan]);

  useEffect(() => {
    if (!showEncodingMenu) return;
    const dismiss = () => setShowEncodingMenu(false);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [showEncodingMenu]);

  // ── file read/write ────────────────────────────────────────────────────────

  const readFileContent = useCallback(async (filePath: string, enc: string) => {
    const res = await window.electronAPI.readFileEncoded(filePath, enc);
    if (res.success) return { content: res.content, error: '' };
    return { content: '', error: res.error || 'read failed' };
  }, []);

  const openFile = useCallback(async (file: MemoryFile) => {
    setSelectedFile(file); setFileContent(''); setFileError('');
    setIsEditing(false); setSaveError(''); setShowEncodingMenu(false);
    setIsBinaryFile(false); setIsImageFile(false); setImageDataUrl('');
    setEncodingAutoDetected(false); setFileLoading(true);

    if (file.type === 'image') {
      setIsImageFile(true);
      try {
        const res = await window.electronAPI.readFileBase64(file.fullPath);
        if (res.success && res.dataUrl) setImageDataUrl(res.dataUrl);
        else setFileError(res.error || 'read failed');
      } catch (e) { setFileError(String(e)); }
      finally { setFileLoading(false); }
      return;
    }
    try {
      const detectRes = await window.electronAPI.detectEncoding(file.fullPath);
      if (detectRes.encoding === 'binary') { setIsBinaryFile(true); setFileLoading(false); return; }
      const detectedEnc = detectRes.encoding || 'utf-8';
      setEncoding(detectedEnc); setEncodingAutoDetected(true);
      const { content, error } = await readFileContent(file.fullPath, detectedEnc);
      if (error) setFileError(error); else setFileContent(content);
    } catch (e) { setFileError(String(e)); }
    finally { setFileLoading(false); }
  }, [readFileContent]);

  const changeEncoding = useCallback(async (newEnc: string) => {
    if (!selectedFile) return;
    setEncoding(newEnc); setEncodingAutoDetected(false); setShowEncodingMenu(false);
    setFileLoading(true); setFileError('');
    try {
      const { content, error } = await readFileContent(selectedFile.fullPath, newEnc);
      if (error) setFileError(error);
      else { setFileContent(content); if (isEditing) setEditContent(content); }
    } catch (e) { setFileError(String(e)); }
    finally { setFileLoading(false); }
  }, [selectedFile, isEditing, readFileContent]);

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

  const forceReadAsText = useCallback(async () => {
    if (!selectedFile) return;
    setIsBinaryFile(false);
    setFileLoading(true);
    setFileError('');
    try {
      const { content, error } = await readFileContent(selectedFile.fullPath, encoding);
      if (error) setFileError(error); else setFileContent(content);
    } catch (e) { setFileError(String(e)); }
    finally { setFileLoading(false); }
  }, [selectedFile, encoding, readFileContent]);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    setIsSaving(true); setSaveError(''); setSaveSuccess(false);
    try {
      const res = await window.electronAPI.writeFile(selectedFile.fullPath, editContent);
      if (res.success) {
        setFileContent(editContent); setIsEditing(false); setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        void runScan();
      } else { setSaveError(res.error || 'save failed'); }
    } catch (e) { setSaveError(String(e)); }
    finally { setIsSaving(false); }
  }, [selectedFile, editContent, runScan]);

  const deleteImageGroup = useCallback(async (group: MemoryGroup) => {
    const filePaths = group.files.map(f => f.fullPath);
    if (filePaths.length === 0) return;
    setImgDeleting(group.dirPath); setImgDeleteConfirm(null);
    try {
      await window.electronAPI.exec(`rm -f ${filePaths.map(p => sq(p)).join(' ')}`);
      if (selectedFile && group.files.some(f => f.fullPath === selectedFile.fullPath)) {
        setSelectedFile(null); setFileContent(''); setIsImageFile(false); setImageDataUrl('');
      }
      await runScan();
    } finally { setImgDeleting(null); }
  }, [selectedFile, runScan]);

  const filterFiles = (files: MemoryFile[]) => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q) || f.fullPath.toLowerCase().includes(q));
  };

  const toggleGroup = (dirPath: string) => {
    setExpandedGroups(prev => { const n = new Set(prev); if (n.has(dirPath)) n.delete(dirPath); else n.add(dirPath); return n; });
  };

  const totalFiles = useMemo(() => groups.reduce((n, g) => n + g.files.length, 0), [groups]);
  const totalSize = useMemo(() => groups.reduce((n, g) => n + g.files.reduce((s, f) => s + f.size, 0), 0), [groups]);

  // ── renderGroup ────────────────────────────────────────────────────────────

  const renderGroup = (group: MemoryGroup) => {
    const filtered = filterFiles(group.files);
    const isExpanded = expandedGroups.has(group.dirPath);
    const isImgGroup = group.section === 'images';
    const isPendingDelete = imgDeleteConfirm === group.dirPath;
    const isDeletingNow = imgDeleting === group.dirPath;

    return (
      <div key={group.dirPath} className="border-b border-slate-100 dark:border-slate-800/50 last:border-0">
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleGroup(group.dirPath)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors text-left${isImgGroup ? ' pr-16' : ''}`}
          >
            {isExpanded ? <ChevronDown size={12} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={12} className="text-slate-400 flex-shrink-0" />}
            <span className={`flex-shrink-0 ${group.accent}`}>{group.icon}</span>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 truncate">{group.label}</span>
              <CustomTooltip content={group.description} delay={0.1}>
                <span
                  className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-help transition-colors flex-shrink-0"
                  onClick={e => e.stopPropagation()}
                >
                  <Info size={13} />
                </span>
              </CustomTooltip>
            </div>
            <span className="text-[10px] font-mono text-slate-400 ml-auto flex-shrink-0">
              {!isPendingDelete && (group.loading ? <Loader2 size={10} className="animate-spin" /> : group.exists ? group.files.length : '—')}
            </span>
          </button>
          {isImgGroup && (
            <div className="absolute right-3 top-0 bottom-0 flex items-center gap-1 pointer-events-none">
              {!isPendingDelete && !isDeletingNow && (
                <button type="button" onClick={e => { e.stopPropagation(); setImgDeleteConfirm(group.dirPath); }} className="pointer-events-auto p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-slate-300 dark:text-slate-600 hover:text-red-400 transition-colors" title={t('memory.imgClearBtn', 'Clear images')}>
                  <Trash2 size={11} />
                </button>
              )}
              {isPendingDelete && (
                <>
                  <button type="button" onClick={e => { e.stopPropagation(); void deleteImageGroup(group); }} className="pointer-events-auto px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-500 hover:bg-red-600 text-white transition-colors">
                    {t('memory.imgClearConfirm', 'Delete')}
                  </button>
                  <button type="button" onClick={e => { e.stopPropagation(); setImgDeleteConfirm(null); }} className="pointer-events-auto px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors">
                    {t('memory.imgClearCancel', 'Cancel')}
                  </button>
                </>
              )}
              {isDeletingNow && <Loader2 size={10} className="pointer-events-auto animate-spin text-red-400" />}
            </div>
          )}
        </div>
        {isExpanded && (
          <div className="pb-1">
            {group.loading && <div className="px-6 py-2"><Loader2 size={13} className="animate-spin text-slate-400 mx-auto" /></div>}
            {!group.loading && !group.exists && <div className="px-6 py-2 text-[11px] text-slate-400 italic">{t('memory.dirNotFound', 'Not found')}</div>}
            {!group.loading && group.exists && filtered.length === 0 && (
              <div className="px-6 py-2 text-[11px] text-slate-400 italic">
                {group.files.length === 0 ? t('memory.empty', 'Empty') : t('memory.noMatch', 'No match')}
              </div>
            )}
            {!group.loading && filtered.map(file => (
              <button
                key={file.fullPath}
                type="button"
                onClick={() => void openFile(file)}
                className={`w-full flex items-center gap-2 px-6 py-2 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors text-left group ${
                  selectedFile?.fullPath === file.fullPath
                    ? 'bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-500'
                    : 'border-l-2 border-transparent'
                }`}
              >
                <span className="flex-shrink-0">{fileIcon(file.type)}</span>
                <span className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate font-medium">{file.name}</span>
                <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">{formatBytes(file.size)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── No workspace ───────────────────────────────────────────────────────────

  if (!agentWorkspace) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="text-center space-y-3">
          <Brain size={40} className="mx-auto text-slate-400 opacity-50" />
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">{t('memory.noWorkspace')}</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs">{t('memory.noWorkspaceHint')}</p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel — file browser */}
      <div className="w-80 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-1 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain size={15} className="text-purple-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t('memory.browser', 'Memory Browser')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {lastScanAt && <span className="text-[10px] text-slate-400 font-mono">{lastScanAt}</span>}
              <button type="button" onClick={() => void runScan()} disabled={totalScanning} className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors disabled:opacity-50" title={t('memory.refresh', 'Refresh')}>
                <RefreshCw size={13} className={totalScanning ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          {agentWorkspace && (
            <div className="flex items-center gap-1 min-w-0">
              <FolderOpen size={10} className="shrink-0 text-slate-400" />
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate" title={agentWorkspace}>{agentWorkspace}</span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="px-4 py-2 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800 flex gap-4">
          <div className={`flex items-center gap-1.5 ${initialLoading ? 'animate-pulse opacity-40' : ''}`}>
            <FileText size={11} className="text-slate-400" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{initialLoading ? '—' : totalFiles} {t('memory.files', 'files')}</span>
          </div>
          <div className={`flex items-center gap-1.5 ${initialLoading ? 'animate-pulse opacity-40' : ''}`}>
            <HardDrive size={11} className="text-slate-400" />
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{initialLoading ? '—' : formatBytes(totalSize)}</span>
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
              placeholder={t('memory.searchPlaceholder', 'Search files…')}
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
        <div className="flex-1 min-h-0 overflow-y-auto pb-4">
          {(() => {
            const soulGroups = groups.filter(g => g.section === 'soul');
            if (soulGroups.length === 0 && !totalScanning) return null;
            return (
              <>
                <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100 dark:border-slate-800/50 sticky top-0 z-10 backdrop-blur-sm">
                  {t('memory.sections.soul', 'Soul')}
                </div>
                {initialLoading
                  ? Array.from({ length: 4 }).map((_, i) => <SkeletonBrowserItem key={i} />)
                  : soulGroups.map(renderGroup)}
              </>
            );
          })()}
          {(() => {
            const docsGroups = groups.filter(g => g.section === 'docs' && (g.loading || g.exists));
            if (docsGroups.length === 0 && !totalScanning) return null;
            return (
              <>
                <div className="px-4 py-2 mt-4 bg-slate-50/80 dark:bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-t border-b border-slate-100 dark:border-slate-800/50 sticky top-0 z-10 backdrop-blur-sm">
                  {t('memory.sections.docs', 'Docs')}
                </div>
                {initialLoading
                  ? Array.from({ length: 3 }).map((_, i) => <SkeletonBrowserItem key={i} />)
                  : docsGroups.map(renderGroup)}
              </>
            );
          })()}
          {(() => {
            const uncatGroups = groups.filter(g => g.section === 'uncategorized');
            if (uncatGroups.length === 0) return null;
            return (
              <>
                <div className="px-4 py-2 mt-4 bg-slate-50/80 dark:bg-slate-900/40 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-t border-b border-slate-100 dark:border-slate-800/50 sticky top-0 z-10 backdrop-blur-sm">
                  {t('memory.sections.uncategorized', 'Other')}
                </div>
                {uncatGroups.map(renderGroup)}
              </>
            );
          })()}
          {(() => {
            const imgGroups = groups.filter(g => g.section === 'images');
            if (imgGroups.length === 0) return null;
            const totalImgFiles = imgGroups.reduce((n, g) => n + g.files.length, 0);
            return (
              <>
                <div className="px-4 py-2 mt-4 bg-pink-50/80 dark:bg-pink-950/20 text-[10px] font-bold uppercase tracking-widest text-pink-400 dark:text-pink-500 border-t border-b border-pink-100 dark:border-pink-900/40 sticky top-0 z-10 backdrop-blur-sm flex items-center justify-between">
                  <div className="flex items-center gap-1.5"><ImageIcon size={10} /><span>{t('memory.sections.images', 'Images')}</span></div>
                  <span className="font-mono text-pink-300 dark:text-pink-600">{totalImgFiles}</span>
                </div>
                {initialLoading
                  ? Array.from({ length: 2 }).map((_, i) => <SkeletonBrowserItem key={i} />)
                  : imgGroups.map(renderGroup)}
              </>
            );
          })()}
          {!totalScanning && groups.length === 0 && (
            <div className="p-6 text-center">
              <Brain size={24} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-xs text-slate-400">{t('memory.noGroups', 'No groups found')}</p>
            </div>
          )}
        </div>

        {/* Workspace hint */}
        {agentWorkspace && (
          <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <div className="flex items-center gap-1.5 cursor-default" title={agentWorkspace}>
              <FolderOpen size={10} className="text-slate-400 flex-shrink-0" />
              <span className="text-[10px] text-slate-400 font-mono truncate">{agentWorkspace}</span>
            </div>
          </div>
        )}
      </div>

      {/* Right panel — file viewer */}
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
                <button type="button" onClick={() => void window.electronAPI.exec(`open ${sq(selectedFile.fullPath.replace(/\/[^/]+$/, ''))}`)} className="p-1 text-slate-500 hover:text-blue-500 transition-colors rounded" title={t('memory.revealInFinder', 'Reveal in Finder')}>
                  <FolderOpen size={12} />
                </button>

                {/* Encoding selector */}
                <div className="relative" onClick={e => e.stopPropagation()}>
                  <button type="button" onClick={() => setShowEncodingMenu(prev => !prev)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors" title={t('memory.encoding', 'Encoding')}>
                    <span>{ALL_ENCODINGS.find(e => e.value === encoding)?.label ?? encoding.toUpperCase()}</span>
                    {encodingAutoDetected && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0 ml-0.5" />}
                    <ChevronDown size={9} />
                  </button>
                  {showEncodingMenu && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 min-w-[180px] max-h-64 overflow-y-auto">
                      {ENCODING_GROUPS.map(group => (
                        <div key={group.label}>
                          <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 sticky top-0">{group.label}</div>
                          {group.options.map(opt => (
                            <button key={opt.value} type="button" onClick={() => void changeEncoding(opt.value)} className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${encoding === opt.value ? 'text-blue-500 font-semibold' : 'text-slate-600 dark:text-slate-300'}`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Edit toggle */}
                {!isBinaryFile && !isEditing && (
                  <button type="button" onClick={enterEditMode} disabled={fileLoading} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-40" title={t('memory.edit', 'Edit')}>
                    <Pencil size={11} /><span>{t('memory.edit', 'Edit')}</span>
                  </button>
                )}
                {isEditing && (
                  <>
                    <button type="button" onClick={() => void saveFile()} disabled={isSaving} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50">
                      {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      <span>{isSaving ? t('memory.saving', 'Saving…') : t('memory.save', 'Save')}</span>
                    </button>
                    <button type="button" onClick={cancelEdit} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-500 hover:text-red-500 transition-colors">
                      <PencilOff size={11} /><span>{t('memory.cancelEdit', 'Cancel')}</span>
                    </button>
                  </>
                )}
                {saveSuccess && !isEditing && (
                  <span className="text-[11px] text-emerald-500 font-medium animate-in fade-in duration-300">{t('memory.saved', 'Saved')}</span>
                )}
                <button type="button" onClick={() => { setSelectedFile(null); setFileContent(''); setIsEditing(false); setIsBinaryFile(false); }} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-400">
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-auto flex flex-col">
              {fileLoading && <div className="flex items-center justify-center h-40"><Loader2 size={20} className="animate-spin text-slate-400" /></div>}
              {!fileLoading && fileError && (
                <div className="m-6 flex items-center gap-2 p-4 bg-red-50 dark:bg-red-950/20 rounded-xl text-red-500 text-sm"><AlertCircle size={16} />{fileError}</div>
              )}
              {!fileLoading && isBinaryFile && (
                <div className="m-6 flex flex-col gap-3">
                  <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-800">
                    <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-amber-700 dark:text-amber-400">{t('memory.binaryFile', 'Binary File')}</p>
                      <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-0.5">{t('memory.binaryFileHint', 'Cannot display')}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => void forceReadAsText()} className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors">
                    <Eye size={12} />{t('memory.forceReadAsText', 'Force read as text')}
                  </button>
                </div>
              )}
              {!fileLoading && saveError && (
                <div className="mx-6 mt-4 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-xl text-red-500 text-xs"><AlertCircle size={13} />{saveError}</div>
              )}
              {!fileLoading && !fileError && !isBinaryFile && !isEditing && !isImageFile && (
                <div className="p-6">
                  {selectedFile.type === 'other' && (
                    <div className="mb-4 flex items-start gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700">
                      <Info size={12} className="text-slate-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('memory.unknownFormatHint', 'Unknown format — displaying as plain text')}</p>
                    </div>
                  )}
                  <pre className={`text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-words ${
                    selectedFile.type === 'md' ? 'text-slate-700 dark:text-slate-300' :
                    selectedFile.type === 'json' ? 'text-emerald-700 dark:text-emerald-300' :
                    selectedFile.type === 'code' ? 'text-orange-700 dark:text-orange-300' :
                    selectedFile.type === 'config' ? 'text-teal-700 dark:text-teal-300' :
                    'text-slate-600 dark:text-slate-400'
                  }`}>
                    {fileContent || <span className="text-slate-400 italic">{t('memory.emptyFile', '(empty file)')}</span>}
                  </pre>
                </div>
              )}
              {!fileLoading && !fileError && isImageFile && imageDataUrl && (
                <div className="p-6 flex items-center justify-center min-h-full">
                  <div className="flex flex-col items-center gap-4">
                    <img src={imageDataUrl} alt={selectedFile?.name} style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 300px)', objectFit: 'contain' }} className="rounded-lg shadow-lg" />
                    <div className="text-center text-[11px] text-slate-500 dark:text-slate-400">
                      <p>{selectedFile?.name}</p>
                      <p className="text-[10px] mt-1 font-mono">{formatBytes(selectedFile?.size || 0)}</p>
                    </div>
                  </div>
                </div>
              )}
              {!fileLoading && !fileError && !isBinaryFile && isEditing && (
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
          <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8 py-10">
            <div className="text-center space-y-3">
              <Eye size={36} className="mx-auto text-slate-200 dark:text-slate-700" />
              <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">{t('memory.selectFile', 'Select a file to view')}</p>
              <p className="text-xs text-slate-300 dark:text-slate-600">{t('memory.selectFileHint', 'Click a file in the browser')}</p>
            </div>

            {/* Excluded formats notice */}
            <div className="w-full max-w-xs space-y-2">
              <div className="flex items-center gap-1.5">
                <Info size={11} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600">
                  {t('memory.excludedTitle', 'Excluded formats')}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {([
                  ['memory.excludedFonts',      'woff / ttf / otf / eot'],
                  ['memory.excludedMedia',      'mp4 / mp3 / wav / flac'],
                  ['memory.excludedArchives',   'zip / tar / gz / 7z'],
                  ['memory.excludedDocs',       'pdf / docx / xlsx / pptx'],
                  ['memory.excludedBinaries',   'exe / dll / so / dylib / .o'],
                  ['memory.excludedDatabases',  'sqlite / db'],
                ] as [string, string][]).map(([key, examples]) => (
                  <div key={key} className="flex flex-col">
                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{t(key, examples)}</span>
                    <span className="text-[9px] font-mono text-slate-300 dark:text-slate-600 truncate">{examples}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
