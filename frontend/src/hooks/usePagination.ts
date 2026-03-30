import { useCallback, useEffect, useMemo, useState } from 'react';

type UsePaginationOptions = {
  totalItems: number;
  initialPageSize?: number;
  pageSizeOptions?: readonly number[];
};

const clampPage = (value: number, maxPage: number) => Math.max(1, Math.min(maxPage, value));

export function usePagination(options: UsePaginationOptions) {
  const { totalItems, initialPageSize = 10, pageSizeOptions = [10, 20, 50] } = options;

  const normalizedOptions = useMemo(() => {
    const list = [...new Set(pageSizeOptions.filter((item) => Number.isFinite(item) && item > 0))].sort((a, b) => a - b);
    return list.length > 0 ? list : [10, 20, 50];
  }, [pageSizeOptions]);

  const initialSize = normalizedOptions.includes(initialPageSize) ? initialPageSize : normalizedOptions[0];

  const [pageSize, setPageSize] = useState<number>(initialSize);
  const [page, setPage] = useState(1);
  const [jumpInput, setJumpInput] = useState('1');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalItems / pageSize)), [totalItems, pageSize]);

  useEffect(() => {
    setPage((current) => {
      const next = clampPage(current, totalPages);
      setJumpInput(String(next));
      return next;
    });
  }, [totalPages]);

  const setPageSafe = useCallback((nextPage: number) => {
    const next = clampPage(nextPage, totalPages);
    setPage(next);
    setJumpInput(String(next));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setPageSafe(page - 1);
  }, [page, setPageSafe]);

  const nextPage = useCallback(() => {
    setPageSafe(page + 1);
  }, [page, setPageSafe]);

  const jumpToInputPage = useCallback(() => {
    const parsed = Number.parseInt(jumpInput, 10);
    if (!Number.isFinite(parsed)) {
      setJumpInput(String(page));
      return;
    }
    setPageSafe(parsed);
  }, [jumpInput, page, setPageSafe]);

  const reset = useCallback(() => {
    setPage(1);
    setJumpInput('1');
  }, []);

  const changePageSize = useCallback((nextSize: number) => {
    const safeSize = normalizedOptions.includes(nextSize) ? nextSize : normalizedOptions[0];
    setPageSize(safeSize);
    setPage(1);
    setJumpInput('1');
  }, [normalizedOptions]);

  const rangeStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = totalItems === 0 ? 0 : Math.min(page * pageSize, totalItems);
  const sliceStart = (page - 1) * pageSize;
  const sliceEnd = sliceStart + pageSize;

  return {
    page,
    pageSize,
    pageSizeOptions: normalizedOptions,
    totalPages,
    totalItems,
    jumpInput,
    canPrev: page > 1,
    canNext: page < totalPages,
    rangeStart,
    rangeEnd,
    sliceStart,
    sliceEnd,
    setJumpInput,
    setPage: setPageSafe,
    prevPage,
    nextPage,
    jumpToInputPage,
    reset,
    changePageSize,
  };
}
