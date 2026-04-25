import { useCallback, useEffect, useState } from 'react';
import type { ActiveTab } from '../types';

type SortByValue = 'familyRoot' | 'status' | 'lastSeenAt' | 'lookupCount' | 'createdAt';
type SortOrderValue = 'asc' | 'desc';
type StatusFilterValue = 'all' | 'unknown' | 'learning' | 'known';
type ImportSourceFilterValue = 'all' | 'manual' | 'preset';

interface UrlParams {
  tab: string;
  page: string;
  pageSize: string;
  sortBy: string;
  sortOrder: string;
  status: string;
  importSource: string;
  search: string;
}

const DEFAULTS: UrlParams = {
  tab: 'overview',
  page: '1',
  pageSize: '20',
  sortBy: 'lastSeenAt',
  sortOrder: 'desc',
  status: 'learning',
  importSource: 'all',
  search: '',
};

function readUrlParams(): UrlParams {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get('tab') || DEFAULTS.tab,
    page: params.get('page') || DEFAULTS.page,
    pageSize: params.get('pageSize') || DEFAULTS.pageSize,
    sortBy: params.get('sortBy') || DEFAULTS.sortBy,
    sortOrder: params.get('sortOrder') || DEFAULTS.sortOrder,
    status: params.get('status') || DEFAULTS.status,
    importSource: params.get('importSource') || DEFAULTS.importSource,
    search: params.get('search') || DEFAULTS.search,
  };
}

export function useUrlState() {
  const [urlParams, setUrlParams] = useState<UrlParams>(readUrlParams);

  const setUrlState = useCallback((updates: Partial<UrlParams>) => {
    setUrlParams((prev) => {
      const next = { ...prev, ...updates };
      const params = new URLSearchParams();
      Object.entries(next).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
      return next;
    });
  }, []);

  useEffect(() => {
    const handlePopState = () => setUrlParams(readUrlParams());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleTabChange = useCallback(
    (tab: ActiveTab) => setUrlState({ tab }),
    [setUrlState],
  );

  return {
    urlParams,
    setUrlState,
    handleTabChange,
    currentPage: parseInt(urlParams.page || '1', 10),
    pageSize: parseInt(urlParams.pageSize || '20', 10),
    sortBy: (urlParams.sortBy as SortByValue) || 'lastSeenAt',
    sortOrder: (urlParams.sortOrder as SortOrderValue) || 'desc',
    statusFilter: (urlParams.status as StatusFilterValue) || 'learning',
    importSourceFilter: (urlParams.importSource as ImportSourceFilterValue) || 'all',
    searchTerm: urlParams.search || '',
    activeTab: (urlParams.tab as ActiveTab) || 'overview',
  };
}
