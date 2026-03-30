type PaginationControlsProps = {
  summaryText: string;
  pageInfoText: string;
  pageSizeLabel: string;
  prevLabel: string;
  nextLabel: string;
  jumpLabel: string;
  jumpPlaceholder: string;
  pageSize: number;
  pageSizeOptions: readonly number[];
  jumpInput: string;
  maxPage: number;
  canPrev: boolean;
  canNext: boolean;
  onPageSizeChange: (size: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onJumpInputChange: (value: string) => void;
  onJump: () => void;
};

export function PaginationControls(props: PaginationControlsProps) {
  const {
    summaryText,
    pageInfoText,
    pageSizeLabel,
    prevLabel,
    nextLabel,
    jumpLabel,
    jumpPlaceholder,
    pageSize,
    pageSizeOptions,
    jumpInput,
    maxPage,
    canPrev,
    canNext,
    onPageSizeChange,
    onPrev,
    onNext,
    onJumpInputChange,
    onJump,
  } = props;

  return (
    <div className="flex flex-col gap-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 md:flex-row md:items-center md:justify-between">
      <span className="order-2 md:order-1">{summaryText}</span>
      <div className="order-1 flex flex-wrap items-center gap-2 md:order-2 md:justify-end">
        <label className="flex items-center gap-1 rounded-md border border-slate-300/70 dark:border-slate-600/70 px-2 py-1">
          <span>{pageSizeLabel}</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-[10px] font-bold"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800"
        >
          {prevLabel}
        </button>

        <span className="min-w-[86px] text-center font-bold text-slate-600 dark:text-slate-300">{pageInfoText}</span>

        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white dark:hover:bg-slate-800"
        >
          {nextLabel}
        </button>

        <div className="flex items-center gap-1 rounded-md border border-slate-300/70 dark:border-slate-600/70 px-1.5 py-1">
          <input
            type="number"
            min={1}
            max={maxPage}
            value={jumpInput}
            onChange={(e) => onJumpInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onJump();
            }}
            className="w-14 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1 text-[10px] font-bold"
            placeholder={jumpPlaceholder}
          />
          <button
            type="button"
            onClick={onJump}
            className="rounded-md border border-slate-300 dark:border-slate-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide hover:bg-white dark:hover:bg-slate-800"
          >
            {jumpLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
