import { useState, useEffect, useCallback } from 'react';
import { LoginPage } from '../popup/LoginPage';
import { isAuthenticated, logout, getCurrentUser } from '../background/api/authApi';
import { fetchWithAuth, fetchJsonWithAuth } from '../background/api/fetchWithAuth';
import { getApiBaseUrl } from '../background/api/apiConfig';
import { Logger } from '../utils/logger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Book,
  Settings,
  Search,
  Download,
  Upload,
  ChevronDown,
  ChevronUp,
  Loader2,
  FileText,
  Sparkles,
  Ban,
  Zap,
  CreditCard,
  BarChart3,
  Info,
  Activity,
  LayoutDashboard,
  PenLine,
  BookOpen,
} from 'lucide-react';

interface VocabularyFamily {
  familyRoot: string;
  wordCount: number;
  status: 'unknown' | 'learning' | 'known';
  familiarityLevel: number;
  lookupCount: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PresetList {
  key: string;
  name: string;
  description: string;
}

interface VocabularyListResponse {
  families: VocabularyFamily[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface VocabularyStats {
  unknown: number;
  learning: number;
  known: number;
  total: number;
  recentFamilies: Array<{
    familyRoot: string;
    lastSeenAt: string;
    lookupCount: number;
  }>;
}

interface SettingsData {
  enabledSites: string[];
  disabledSites: string[];
  aiMode: 'auto' | 'manual' | 'off';
  autoIncreaseFamiliarity: boolean; // 新增：自动提升熟练度开关
  showFamiliarityInCard: boolean; // 新增：是否在卡片中展示熟练度
  enhancedPhraseDetection: boolean; // 新增：AI增强词组检测开关
  sentenceAnalysisMode: 'always' | 'smart' | 'off'; // 新增：长难句分析模式（始终开启、智能判断、始终关闭）
  extensionEnabled: boolean; // 新增：全局功能开关
  highlightEnabled: boolean; // 新增：高亮功能开关
}

const logger = new Logger('Options');

export default function Options() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<{
    id: number;
    email: string;
  } | null>(null);
  const [vocabularyData, setVocabularyData] = useState<VocabularyListResponse | null>(null);
  const [stats, setStats] = useState<VocabularyStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [accumulatedSelection, setAccumulatedSelection] = useState<Set<string>>(new Set()); // 跨页累加选择
  const [settings, setSettings] = useState<SettingsData>({
    enabledSites: [],
    disabledSites: [],
    aiMode: 'auto',
    autoIncreaseFamiliarity: true, // 默认开启
    showFamiliarityInCard: true, // 默认显示
    enhancedPhraseDetection: true, // 默认开启
    sentenceAnalysisMode: 'smart', // 默认智能判断
    extensionEnabled: true, // 默认启用
    highlightEnabled: true, // 默认启用
  });

  // 词族展开相关状态
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [familyWordsCache, setFamilyWordsCache] = useState<Record<string, string[]>>({});
  const [loadingFamily, setLoadingFamily] = useState<string | null>(null);

  // 分页和过滤参数 - 使用自定义 URL 状态管理
  const getUrlParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      tab: params.get('tab') || 'overview',
      page: params.get('page') || '1',
      pageSize: params.get('pageSize') || '20',
      sortBy: params.get('sortBy') || 'lastSeenAt',
      sortOrder: params.get('sortOrder') || 'desc',
      status: params.get('status') || 'learning',
      importSource: params.get('importSource') || 'all',
      search: params.get('search') || '',
    };
  }, []);

  const [urlParams, setUrlParams] = useState(getUrlParams);

  // 更新URL参数
  const setUrlState = useCallback(
    (updates: Partial<typeof urlParams>) => {
      const newParams = { ...urlParams, ...updates };
      const params = new URLSearchParams();
      Object.entries(newParams).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
      setUrlParams(newParams);
    },
    [urlParams],
  );

  // 监听浏览器前进后退
  useEffect(() => {
    const handlePopState = () => {
      setUrlParams(getUrlParams());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getUrlParams]);

  // 从 URL 参数中解析出实际使用的值
  const currentPage = parseInt(urlParams.page || '1', 10);
  const pageSize = parseInt(urlParams.pageSize || '20', 10);
  const sortBy =
    (urlParams.sortBy as 'familyRoot' | 'status' | 'lastSeenAt' | 'lookupCount' | 'createdAt') ||
    'lastSeenAt';
  const sortOrder = (urlParams.sortOrder as 'asc' | 'desc') || 'desc';
  const statusFilter = (urlParams.status as 'all' | 'unknown' | 'learning' | 'known') || 'learning';
  const importSourceFilter = (urlParams.importSource as 'all' | 'manual' | 'preset') || 'all';
  const searchTerm = urlParams.search || '';

  // activeTab 从 URL 参数中同步
  const activeTab =
    (urlParams.tab as
      | 'overview'
      | 'vocabulary-list'
      | 'vocabulary-ignored'
      | 'vocabulary-import'
      | 'features'
      | 'article-analysis') || 'overview';

  const [presetLists, setPresetLists] = useState<PresetList[]>([]);

  // 忽略列表状态
  const [ignoredWords, setIgnoredWords] = useState<string[]>([]);
  const [ignoredWordsLoading, setIgnoredWordsLoading] = useState(false);

  // 文章难度分析状态
  const [articleText, setArticleText] = useState('');
  const [analysisResult, setAnalysisResult] = useState<{
    totalWords: number;
    uniqueWords: number;
    knownWords: string[];
    learningWords: string[];
    unknownWords: string[];
    notInDictWords: string[];
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // 导出相关状态
  const [exportFormat, setExportFormat] = useState<'json' | 'txt' | 'json-array'>('json');
  const [exportStatusFilter, setExportStatusFilter] = useState<'all' | 'learning' | 'known'>('all');

  // 更新 URL 参数（包括tab）
  const updateUrlTab = useCallback(
    (tab: string) => {
      setUrlState({ tab });
    },
    [setUrlState],
  );

  // 切换 tab 并更新 URL
  const handleTabChange = (
    tab:
      | 'overview'
      | 'vocabulary-list'
      | 'vocabulary-ignored'
      | 'vocabulary-import'
      | 'features'
      | 'article-analysis',
  ) => {
    updateUrlTab(tab);
  };

  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    const loggedIn = await isAuthenticated();
    setIsLoggedIn(loggedIn);
    if (loggedIn) {
      const user = await getCurrentUser();
      setCurrentUser(user);
    }
  };

  const handleLoginSuccess = async () => {
    await checkLoginStatus();
  };

  const handleLogout = async () => {
    await logout();
    setIsLoggedIn(false);
    setCurrentUser(null);
    setVocabularyData(null);
  };

  const loadVocabulary = useCallback(async () => {
    if (!isLoggedIn) return;

    setLoading(true);
    try {
      const baseUrl = await getApiBaseUrl();
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: pageSize.toString(),
        sortBy,
        sortOrder,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(importSourceFilter !== 'all' && { importSource: importSourceFilter }),
        ...(searchTerm && { search: searchTerm }),
      });

      const data = await fetchJsonWithAuth<VocabularyListResponse>(
        `${baseUrl}/vocabulary/list?${params}`,
      );
      setVocabularyData(data);
    } catch (error) {
      logger.error('Failed to load vocabulary', error as Error);
    } finally {
      setLoading(false);
    }
  }, [
    isLoggedIn,
    currentPage,
    pageSize,
    sortBy,
    sortOrder,
    statusFilter,
    importSourceFilter,
    searchTerm,
  ]);

  useEffect(() => {
    if (isLoggedIn) {
      loadVocabulary();
      fetchPresets();
      loadStats();
    }
    loadSettings();
    loadIgnoredWords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, loadVocabulary]);

  const loadStats = async () => {
    if (!isLoggedIn) return;

    setStatsLoading(true);
    try {
      const baseUrl = await getApiBaseUrl();
      const data = await fetchJsonWithAuth<VocabularyStats>(`${baseUrl}/vocabulary/stats`);
      setStats(data);
    } catch (error) {
      logger.error('Failed to load stats', error as Error);
    } finally {
      setStatsLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffHours < 1) {
      return '刚刚';
    } else if (diffHours < 24) {
      return `${Math.floor(diffHours)} 小时前`;
    } else {
      const days = Math.floor(diffHours / 24);
      return days === 0 ? '今天' : `${days} 天前`;
    }
  };

  const loadSettings = async () => {
    try {
      const result = await chrome.storage?.sync.get([
        'siteSettings',
        'aiMode',
        'autoIncreaseFamiliarity',
        'showFamiliarityInCard',
        'enhancedPhraseDetection',
        'sentenceAnalysisMode',
        'extensionEnabled',
        'highlightEnabled',
      ]);
      if (result?.siteSettings) {
        setSettings((prev) => ({
          ...prev,
          enabledSites: result.siteSettings.enabled || [],
          disabledSites: result.siteSettings.disabled || [],
        }));
      }
      if (result?.aiMode) {
        setSettings((prev) => ({
          ...prev,
          aiMode: result.aiMode,
        }));
      }
      if (result?.autoIncreaseFamiliarity !== undefined) {
        setSettings((prev) => ({
          ...prev,
          autoIncreaseFamiliarity: result.autoIncreaseFamiliarity,
        }));
      }
      if (result?.showFamiliarityInCard !== undefined) {
        setSettings((prev) => ({
          ...prev,
          showFamiliarityInCard: result.showFamiliarityInCard,
        }));
      }
      if (result?.enhancedPhraseDetection !== undefined) {
        setSettings((prev) => ({
          ...prev,
          enhancedPhraseDetection: result.enhancedPhraseDetection,
        }));
      }
      if (result?.sentenceAnalysisMode !== undefined) {
        setSettings((prev) => ({
          ...prev,
          sentenceAnalysisMode: result.sentenceAnalysisMode,
        }));
      }
      if (result?.extensionEnabled !== undefined) {
        setSettings((prev) => ({
          ...prev,
          extensionEnabled: result.extensionEnabled,
        }));
      }
      if (result?.highlightEnabled !== undefined) {
        setSettings((prev) => ({
          ...prev,
          highlightEnabled: result.highlightEnabled,
        }));
      }
    } catch (error) {
      logger.error('Failed to load settings', error as Error);
    }
  };

  const loadIgnoredWords = async () => {
    setIgnoredWordsLoading(true);
    try {
      const result = await chrome.storage?.sync.get(['ignoredWords']);
      setIgnoredWords(result?.ignoredWords || []);
    } catch (error) {
      logger.error('Failed to load ignored words', error as Error);
    } finally {
      setIgnoredWordsLoading(false);
    }
  };

  const removeIgnoredWord = async (word: string) => {
    try {
      const updatedWords = ignoredWords.filter((w) => w !== word);
      await chrome.storage?.sync.set({ ignoredWords: updatedWords });
      setIgnoredWords(updatedWords);
    } catch (error) {
      logger.error('Failed to remove ignored word', error as Error);
      alert('移除失败');
    }
  };

  const clearIgnoredWords = async () => {
    if (!confirm('确定要清空所有忽略的词汇吗？')) return;

    try {
      await chrome.storage?.sync.set({ ignoredWords: [] });
      setIgnoredWords([]);
    } catch (error) {
      logger.error('Failed to clear ignored words', error as Error);
      alert('清空失败');
    }
  };

  // 文章难度分析功能
  const analyzeArticle = async () => {
    if (!articleText.trim()) {
      alert('请输入文章内容');
      return;
    }

    setAnalyzing(true);
    try {
      // 1. 提取所有单词
      const words = articleText.toLowerCase().match(/\b[a-z]+(?:'[a-z]+)?\b/g) || [];

      const uniqueWords = Array.from(new Set(words));

      if (uniqueWords.length === 0) {
        alert('未能提取到有效的英文单词');
        setAnalyzing(false);
        return;
      }

      // 2. 查询单词状态
      const baseUrl = await getApiBaseUrl();
      const response = await fetchJsonWithAuth<{
        [word: string]: {
          status: 'unknown' | 'learning' | 'known';
          familyRoot: string;
          familiarityLevel: number;
        };
      }>(`${baseUrl}/vocabulary/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ words: uniqueWords }),
      });

      // 3. 分类统计
      const knownWords: string[] = [];
      const learningWords: string[] = [];
      const unknownWords: string[] = [];
      const notInDictWords: string[] = [];

      uniqueWords.forEach((word) => {
        if (response[word]) {
          const status = response[word].status;
          if (status === 'known') {
            knownWords.push(word);
          } else if (status === 'learning') {
            learningWords.push(word);
          } else {
            unknownWords.push(word);
          }
        } else {
          notInDictWords.push(word);
        }
      });

      setAnalysisResult({
        totalWords: words.length,
        uniqueWords: uniqueWords.length,
        knownWords,
        learningWords,
        unknownWords,
        notInDictWords,
      });
    } catch (error) {
      logger.error('Failed to analyze article', error as Error);
      alert('分析失败，请稍后重试');
    } finally {
      setAnalyzing(false);
    }
  };

  const saveSettings = async () => {
    try {
      await chrome.storage?.sync.set({
        siteSettings: {
          enabled: settings.enabledSites,
          disabled: settings.disabledSites,
        },
        aiSettings: {
          mode: settings.aiMode,
        },
        autoIncreaseFamiliarity: settings.autoIncreaseFamiliarity,
        showFamiliarityInCard: settings.showFamiliarityInCard,
        enhancedPhraseDetection: settings.enhancedPhraseDetection,
        sentenceAnalysisMode: settings.sentenceAnalysisMode,
        extensionEnabled: settings.extensionEnabled,
        highlightEnabled: settings.highlightEnabled,
      });
      alert('设置已保存！');
    } catch (error) {
      logger.error('Failed to save settings', error as Error);
      alert('保存设置失败');
    }
  };

  const handleToggleRow = async (familyRoot: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(familyRoot)) {
      newExpanded.delete(familyRoot);
    } else {
      newExpanded.add(familyRoot);
      if (!familyWordsCache[familyRoot]) {
        setLoadingFamily(familyRoot);
        try {
          const baseUrl = await getApiBaseUrl();
          const words = await fetchJsonWithAuth<string[]>(
            `${baseUrl}/vocabulary/family/${encodeURIComponent(familyRoot)}`,
          );
          setFamilyWordsCache((prev) => ({ ...prev, [familyRoot]: words }));
        } catch (error) {
          logger.error('Failed to fetch family words', error as Error);
          alert('获取词族单词失败');
        } finally {
          setLoadingFamily(null);
        }
      }
    }
    setExpandedRows(newExpanded);
  };

  const updateFamilyStatus = async (
    familyRoot: string,
    newStatus: 'unknown' | 'learning' | 'known',
  ) => {
    try {
      const baseUrl = await getApiBaseUrl();
      await fetchJsonWithAuth(`${baseUrl}/vocabulary/${encodeURIComponent(familyRoot)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: newStatus,
        }),
      });
      loadVocabulary();
    } catch (error) {
      logger.error('Failed to update family status', error as Error);
      alert('更新失败');
    }
  };

  // 新增：更新熟练度
  const updateFamiliarityLevel = async (familyRoot: string, level: number) => {
    try {
      const baseUrl = await getApiBaseUrl();
      await fetchJsonWithAuth(`${baseUrl}/vocabulary/${encodeURIComponent(familyRoot)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          familiarityLevel: level,
        }),
      });
      loadVocabulary();
    } catch (error) {
      logger.error('Failed to update familiarity level', error as Error);
      alert('更新熟练度失败');
    }
  };

  const batchUpdateStatus = async (newStatus: 'unknown' | 'learning' | 'known') => {
    const totalSelected = accumulatedSelection.size + selectedWords.size;
    if (totalSelected === 0) {
      alert('请先选择要更新的词族');
      return;
    }

    try {
      // 合并累积选择和当前页选择
      const allSelectedWords = new Set([...accumulatedSelection, ...selectedWords]);

      // 批量更新选中的词族
      const promises = Array.from(allSelectedWords).map((familyRoot) =>
        updateFamilyStatus(familyRoot, newStatus),
      );

      await Promise.all(promises);
      setSelectedWords(new Set());
      setAccumulatedSelection(new Set());
      loadVocabulary();
    } catch (error) {
      logger.error('Batch update failed', error as Error);
      alert('批量更新失败');
    }
  };

  const exportVocabulary = async () => {
    try {
      const baseUrl = await getApiBaseUrl();

      // 根据格式选择不同的API端点
      let endpoint = '';
      let filename = '';
      let fileExtension = '';

      switch (exportFormat) {
        case 'txt':
          endpoint = '/vocabulary/export/txt';
          fileExtension = 'txt';
          break;
        case 'json-array':
          endpoint = '/vocabulary/export/json-array';
          fileExtension = 'json';
          break;
        case 'json':
        default:
          endpoint = '/vocabulary/export';
          fileExtension = 'json';
          break;
      }

      // 添加状态筛选参数（如果不是"全部"）
      const params = new URLSearchParams();
      if (exportStatusFilter !== 'all') {
        params.append('status', exportStatusFilter);
      }

      const url = `${baseUrl}${endpoint}${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetchWithAuth(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;

      // 生成文件名
      const dateStr = new Date().toISOString().split('T')[0];
      const statusStr = exportStatusFilter !== 'all' ? `-${exportStatusFilter}` : '';
      filename = `vocabulary${statusStr}-${dateStr}.${fileExtension}`;
      a.download = filename;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);

      alert('导出成功！');
    } catch (error) {
      logger.error('Export error', error as Error);
      alert('导出失败');
    }
  };

  const fetchPresets = async () => {
    if (!isLoggedIn) return;

    try {
      const baseUrl = await getApiBaseUrl();
      const data = await fetchJsonWithAuth<PresetList[]>(`${baseUrl}/vocabulary/presets`);
      setPresetLists(data);
    } catch (error) {
      logger.error('Failed to fetch preset lists', error as Error);
    }
  };

  const addPresetVocabulary = async (listKey: string) => {
    setLoading(true);
    try {
      const baseUrl = await getApiBaseUrl();
      const data = await fetchJsonWithAuth<any>(`${baseUrl}/vocabulary/add-preset/${listKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      alert(`${data.message}！\n已添加 ${data.count} 个词元\n共 ${data.familiesAdded} 个词族`);
      loadVocabulary();
    } catch (error) {
      logger.error('Failed to add preset vocabulary', error as Error);
      alert('添加词库失败');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const baseUrl = await getApiBaseUrl();
      const response = await fetchWithAuth(`${baseUrl}/vocabulary/import`, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      alert(`${result.message}: 导入 ${result.imported} 个, 跳过 ${result.skipped} 个.`);
      loadVocabulary();
    } catch (error) {
      logger.error('导入错误', error as Error);
      alert('导入失败');
    } finally {
      setLoading(false);
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'unknown':
        return '陌生';
      case 'learning':
        return '学习中';
      case 'known':
        return '已掌握';
      default:
        return '未知';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'known':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'learning':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'unknown':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const toggleFamilySelection = (familyRoot: string) => {
    const newSelection = new Set(selectedWords);
    const accumulated = new Set(accumulatedSelection);

    // 如果在当前页选择中，从当前页移除
    if (newSelection.has(familyRoot)) {
      newSelection.delete(familyRoot);
    }
    // 如果在累积选择中，从累积中移除
    else if (accumulated.has(familyRoot)) {
      accumulated.delete(familyRoot);
      setAccumulatedSelection(accumulated);
    }
    // 否则添加到当前页选择
    else {
      newSelection.add(familyRoot);
    }
    setSelectedWords(newSelection);
  };

  const toggleSelectAll = () => {
    if (!vocabularyData || !vocabularyData.families) return;

    // 检查当前页是否全选
    const allCurrentPageSelected = vocabularyData.families.every(
      (family) =>
        selectedWords.has(family.familyRoot) || accumulatedSelection.has(family.familyRoot),
    );

    if (allCurrentPageSelected) {
      // 如果当前页全选，则取消当前页的选择
      const newSelection = new Set(selectedWords);
      const accumulated = new Set(accumulatedSelection);
      vocabularyData.families.forEach((family) => {
        newSelection.delete(family.familyRoot);
        accumulated.delete(family.familyRoot);
      });
      setSelectedWords(newSelection);
      setAccumulatedSelection(accumulated);
    } else {
      // 否则全选当前页
      // 1. 将当前页已选但不在累积中的项移到累积中
      const currentPageFamilyRoots = new Set(vocabularyData.families.map((f) => f.familyRoot));
      const newAccumulated = new Set(accumulatedSelection);

      selectedWords.forEach((familyRoot) => {
        // 如果这个选择不在当前页，把它加到累积中
        if (!currentPageFamilyRoots.has(familyRoot)) {
          newAccumulated.add(familyRoot);
        }
      });

      // 2. 设置当前页的选择为当前页所有项
      setAccumulatedSelection(newAccumulated);
      setSelectedWords(currentPageFamilyRoots);
    }
  };

  if (isLoggedIn === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* 左侧菜单 - 固定高度 */}
      <aside className="flex h-full w-64 flex-col border-r border-gray-200 bg-white">
        <div className="flex gap-3 border-b items-center py-6 px-5">
          {/* icon */}
          <img src="/logo.png" alt="LinguoLand Logo" className="h-8 w-8 mt-[-6px]" />
          <div className=" border-gray-200 pl-0">
            <h1 className="text-2xl font-bold text-gray-900 flex">LinguoLand</h1>
            {currentUser && <p className="mt-1 text-xs text-gray-500">{currentUser.email}</p>}
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {/* 概览 */}
          <div className="space-y-1">
            <button
              onClick={() => handleTabChange('overview')}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                activeTab === 'overview'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutDashboard className="h-5 w-5" />
              概览
            </button>
          </div>

          {/* 词汇管理 - 父菜单 */}
          <div className="mt-4 space-y-1">
            <div className="px-4 py-2 text-xs font-semibold uppercase text-gray-500">词汇管理</div>
            <button
              onClick={() => handleTabChange('vocabulary-list')}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                activeTab === 'vocabulary-list'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Book className="h-5 w-5" />
              词汇列表
            </button>
            <button
              onClick={() => handleTabChange('vocabulary-ignored')}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                activeTab === 'vocabulary-ignored'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Ban className="h-5 w-5" />
              忽略列表
            </button>
            <button
              onClick={() => handleTabChange('vocabulary-import')}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                activeTab === 'vocabulary-import'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Upload className="h-5 w-5" />
              导入导出
            </button>
          </div>

          {/* 工具 - 父菜单 */}
          <div className="mt-4 space-y-1">
            <div className="px-4 py-2 text-xs font-semibold uppercase text-gray-500">工具</div>
            <button
              onClick={() => handleTabChange('article-analysis')}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                activeTab === 'article-analysis'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FileText className="h-5 w-5" />
              文章难度分析（BETA）
            </button>
          </div>

          {/* 设置 - 父菜单 */}
          <div className="mt-4 space-y-1">
            <div className="px-4 py-2 text-xs font-semibold uppercase text-gray-500">设置</div>
            <button
              onClick={() => handleTabChange('features')}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${
                activeTab === 'features'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Settings className="h-5 w-5" />
              功能配置
            </button>
          </div>
        </nav>

        <div className="border-t border-gray-200 p-4">
          <Button onClick={handleLogout} className="w-full text-font-base">
            退出登录
          </Button>
        </div>
      </aside>

      {/* 右侧内容区域 - 固定高度，独立滚动 */}
      <main className="flex h-full flex-1 flex-col overflow-hidden px-6 py-7">
        <div className="flex-1 overflow-y-auto">
          <div className="container max-w-7xl ">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-3xl font-bold text-gray-900">概览</h2>
                  <p className="mt-2 text-gray-600">查看你的学习统计和最近活动</p>
                </div>

                {/* 统计概览 */}
                {statsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="ml-2">加载中...</span>
                  </div>
                ) : stats ? (
                  <>
                    {/* 词族统计卡片 */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-gray-600">
                            陌生词族
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline gap-2">
                            <div className="text-3xl font-bold text-orange-600">
                              {stats.unknown}
                            </div>
                            <div className="h-3 w-3 rounded-full bg-orange-500"></div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-gray-600">
                            学习中
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline gap-2">
                            <div className="text-3xl font-bold text-blue-600">{stats.learning}</div>
                            <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-gray-600">
                            已掌握
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline gap-2">
                            <div className="text-3xl font-bold text-green-600">{stats.known}</div>
                            <div className="h-3 w-3 rounded-full bg-green-500"></div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-gray-600">
                            词族总计
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline gap-2">
                            <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
                            <BookOpen className="h-4 w-4 text-gray-500" />
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* 学习进度可视化 */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <BarChart3 className="h-5 w-5" />
                          学习进度
                        </CardTitle>
                        <CardDescription>你的词汇掌握情况</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">已掌握</span>
                              <span className="font-medium">
                                {stats.total > 0
                                  ? ((stats.known / stats.total) * 100).toFixed(1)
                                  : 0}
                                %
                              </span>
                            </div>
                            <Progress
                              value={stats.total > 0 ? (stats.known / stats.total) * 100 : 0}
                              className="h-2"
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">学习中</span>
                              <span className="font-medium">
                                {stats.total > 0
                                  ? ((stats.learning / stats.total) * 100).toFixed(1)
                                  : 0}
                                %
                              </span>
                            </div>
                            <Progress
                              value={stats.total > 0 ? (stats.learning / stats.total) * 100 : 0}
                              className="h-2"
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600">陌生词</span>
                              <span className="font-medium">
                                {stats.total > 0
                                  ? ((stats.unknown / stats.total) * 100).toFixed(1)
                                  : 0}
                                %
                              </span>
                            </div>
                            <Progress
                              value={stats.total > 0 ? (stats.unknown / stats.total) * 100 : 0}
                              className="h-2"
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 最近遇到的生词族 */}
                    {stats.recentFamilies && stats.recentFamilies.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <PenLine className="h-5 w-5" />
                            最近遇到的词族
                          </CardTitle>
                          <CardDescription>最近学习和查询的词汇</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {stats.recentFamilies.slice(0, 10).map((family) => (
                              <div
                                key={family.familyRoot}
                                className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-0 last:pb-0"
                              >
                                <div>
                                  <div className="font-medium text-gray-900">
                                    {family.familyRoot}
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    查词 {family.lookupCount} 次
                                  </div>
                                </div>
                                <div className="text-sm text-gray-500">
                                  {formatDate(family.lastSeenAt)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center text-gray-500">
                      暂无统计数据
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {activeTab === 'vocabulary-list' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-3xl font-bold text-gray-900">词汇列表</h2>
                </div>

                {/* 控制面板 */}
                <Card>
                  {/* <CardHeader>
                    <CardTitle>搜索与筛选</CardTitle>
                  </CardHeader> */}
                  <CardContent className="space-y-4 pt-4">
                    {/* 搜索 */}
                    <div className="flex gap-5 items-end">
                      {/* 过滤器 */}
                      <div className="flex flex-wrap items-center gap-5">
                        <div className="w-28">
                          <Label>状态</Label>
                          <Select
                            value={statusFilter}
                            onValueChange={(v: string) => setUrlState({ status: v, page: '1' })}
                          >
                            <SelectTrigger className="mt-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">全部</SelectItem>
                              <SelectItem value="unknown">陌生</SelectItem>
                              <SelectItem value="learning">学习中</SelectItem>
                              <SelectItem value="known">已掌握</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-28">
                          <Label>来源</Label>
                          <Select
                            value={importSourceFilter}
                            onValueChange={(v: string) =>
                              setUrlState({ importSource: v, page: '1' })
                            }
                          >
                            <SelectTrigger className="mt-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">全部</SelectItem>
                              <SelectItem value="manual">手动添加</SelectItem>
                              <SelectItem value="preset">预设导入</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-28">
                          <Label>排序</Label>
                          <Select
                            value={sortBy}
                            onValueChange={(v: string) => setUrlState({ sortBy: v, page: '1' })}
                          >
                            <SelectTrigger className="mt-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="lastSeenAt">最后见到</SelectItem>
                              <SelectItem value="familyRoot">词族</SelectItem>
                              <SelectItem value="status">状态</SelectItem>
                              <SelectItem value="lookupCount">查词次数</SelectItem>
                              <SelectItem value="createdAt">创建时间</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-28">
                          <Label>顺序</Label>
                          <Select
                            value={sortOrder}
                            onValueChange={(v: string) => setUrlState({ sortOrder: v, page: '1' })}
                          >
                            <SelectTrigger className="mt-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="desc">降序</SelectItem>
                              <SelectItem value="asc">升序</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-28">
                          <Label>每页数量</Label>
                          <Select
                            value={String(pageSize)}
                            onValueChange={(v: string) => setUrlState({ pageSize: v, page: '1' })}
                          >
                            <SelectTrigger className="mt-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="10">10</SelectItem>
                              <SelectItem value="20">20</SelectItem>
                              <SelectItem value="50">50</SelectItem>
                              <SelectItem value="100">100</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <Input
                          value={searchTerm}
                          onChange={(e) => setUrlState({ search: e.target.value, page: '1' })}
                          placeholder="搜索单词..."
                          className="max-w-[200px]"
                        />
                        <Search className="h-5 w-5 text-gray-400 ml-2" />
                      </div>
                    </div>

                    {/* 批量操作 */}
                    <div className="space-y-2"></div>
                  </CardContent>
                </Card>

                {/* 词汇表格 */}
                <Card>
                  <CardHeader className="flex flex-row justify-between items-center">
                    <CardTitle>词汇列表</CardTitle>
                    <div className="ml-auto">
                      {(accumulatedSelection.size > 0 || selectedWords.size > 0) && (
                        <div className="text-sm text-gray-500 p-2 rounded mr-2">
                          已选中 {accumulatedSelection.size + selectedWords.size} 个词族
                          {accumulatedSelection.size > 0 &&
                            ` (含跨页 ${accumulatedSelection.size} 个)`}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => batchUpdateStatus('unknown')}
                        disabled={accumulatedSelection.size === 0 && selectedWords.size === 0}
                      >
                        标记为陌生
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => batchUpdateStatus('learning')}
                        disabled={accumulatedSelection.size === 0 && selectedWords.size === 0}
                      >
                        学习中
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => batchUpdateStatus('known')}
                        disabled={accumulatedSelection.size === 0 && selectedWords.size === 0}
                      >
                        已掌握
                      </Button>
                      {(accumulatedSelection.size > 0 || selectedWords.size > 0) && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSelectedWords(new Set());
                            setAccumulatedSelection(new Set());
                          }}
                        >
                          清空选择
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {loading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin" />
                        <span className="ml-2">加载中...</span>
                      </div>
                    )}

                    {vocabularyData && vocabularyData.families && !loading && (
                      <>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-12">
                                  <Checkbox
                                    checked={
                                      vocabularyData.families.length > 0 &&
                                      vocabularyData.families.every(
                                        (family) =>
                                          selectedWords.has(family.familyRoot) ||
                                          accumulatedSelection.has(family.familyRoot),
                                      )
                                    }
                                    onCheckedChange={toggleSelectAll}
                                  />
                                </TableHead>
                                <TableHead className="w-12"></TableHead>
                                <TableHead>词族</TableHead>
                                <TableHead>词数</TableHead>
                                <TableHead>状态</TableHead>
                                <TableHead>熟练度</TableHead>
                                <TableHead>查词次数</TableHead>
                                <TableHead>最后见到</TableHead>
                                <TableHead>操作</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {vocabularyData.families.map((family) => (
                                <>
                                  <TableRow key={family.familyRoot}>
                                    <TableCell>
                                      <Checkbox
                                        checked={
                                          selectedWords.has(family.familyRoot) ||
                                          accumulatedSelection.has(family.familyRoot)
                                        }
                                        onCheckedChange={() =>
                                          toggleFamilySelection(family.familyRoot)
                                        }
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <button
                                        onClick={() => handleToggleRow(family.familyRoot)}
                                        className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                                      >
                                        {expandedRows.has(family.familyRoot) ? (
                                          <ChevronUp className="h-4 w-4" />
                                        ) : (
                                          <ChevronDown className="h-4 w-4" />
                                        )}
                                      </button>
                                    </TableCell>
                                    <TableCell className="font-medium">
                                      {family.familyRoot}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline">{family.wordCount}</Badge>
                                    </TableCell>
                                    <TableCell>
                                      <Badge className={getStatusColor(family.status)}>
                                        {getStatusDisplay(family.status)}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <span className="min-w-[3rem] text-sm">
                                          {family.familiarityLevel}/7
                                        </span>
                                        <div className="w-24">
                                          <Progress
                                            value={(family.familiarityLevel / 7) * 100}
                                            className="h-2"
                                          />
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell>{family.lookupCount}</TableCell>
                                    <TableCell className="text-sm text-gray-500">
                                      {formatDateTime(family.lastSeenAt)}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex gap-1">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={family.status === 'unknown'}
                                          onClick={() =>
                                            updateFamilyStatus(family.familyRoot, 'unknown')
                                          }
                                        >
                                          陌生
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={family.status === 'learning'}
                                          onClick={() =>
                                            updateFamilyStatus(family.familyRoot, 'learning')
                                          }
                                        >
                                          学习中
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={family.status === 'known'}
                                          onClick={() =>
                                            updateFamilyStatus(family.familyRoot, 'known')
                                          }
                                        >
                                          已掌握
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                  {expandedRows.has(family.familyRoot) && (
                                    <TableRow>
                                      <TableCell
                                        colSpan={9}
                                        className="bg-gray-50 dark:bg-gray-900"
                                      >
                                        <div className="space-y-4 p-4">
                                          <div>
                                            <h4 className="mb-2 font-semibold">词族内单词</h4>
                                            {loadingFamily === family.familyRoot ? (
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                              <div className="flex flex-wrap gap-2">
                                                {familyWordsCache[family.familyRoot]?.map(
                                                  (word) => (
                                                    <Badge key={word} variant="secondary">
                                                      {word}
                                                    </Badge>
                                                  ),
                                                )}
                                              </div>
                                            )}
                                          </div>
                                          <div>
                                            <Label className="mb-2 block">
                                              熟练度调整 ({family.familiarityLevel}/7)
                                            </Label>
                                            <div className="flex items-center gap-4">
                                              <Slider
                                                value={[family.familiarityLevel]}
                                                onValueChange={([value]) =>
                                                  updateFamiliarityLevel(family.familyRoot, value)
                                                }
                                                max={7}
                                                min={0}
                                                step={1}
                                                className="w-64"
                                              />
                                              <span className="text-sm text-gray-500">
                                                拖动滑块调整熟练度
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                </>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        {/* 分页 */}
                        <div className="mt-4 flex items-center justify-between">
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            显示 {(currentPage - 1) * pageSize + 1} 到{' '}
                            {Math.min(currentPage * pageSize, vocabularyData.total)} 条，共{' '}
                            {vocabularyData.total} 条记录
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setUrlState({ page: '1' })}
                              disabled={currentPage === 1}
                            >
                              首页
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setUrlState({ page: String(Math.max(1, currentPage - 1)) })
                              }
                              disabled={currentPage === 1}
                            >
                              上一页
                            </Button>
                            <span className="flex items-center px-4 text-sm">
                              第 {currentPage} / {vocabularyData.totalPages} 页
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setUrlState({
                                  page: String(
                                    Math.min(vocabularyData.totalPages, currentPage + 1),
                                  ),
                                })
                              }
                              disabled={currentPage === vocabularyData.totalPages}
                            >
                              下一页
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setUrlState({ page: String(vocabularyData.totalPages) })
                              }
                              disabled={currentPage === vocabularyData.totalPages}
                            >
                              末页
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'vocabulary-import' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-3xl font-bold text-gray-900">导入导出</h2>
                  <p className="mt-2 text-gray-600">管理你的词汇数据导入导出</p>
                </div>

                {/* 导出词汇 */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Download className="mr-2 inline h-5 w-5" />
                      导出词汇
                    </CardTitle>
                    <CardDescription>将你的词汇库导出为不同格式的文件</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* 导出格式选择 */}
                      <div className="space-y-2">
                        <Label>导出格式</Label>
                        <RadioGroup
                          value={exportFormat}
                          onValueChange={(v: any) => setExportFormat(v)}
                        >
                          <div className="space-y-2">
                            <div className="flex items-start space-x-3">
                              <RadioGroupItem value="json" id="export-json" className="mt-1" />
                              <div className="flex-1">
                                <Label htmlFor="export-json" className="font-medium">
                                  完整 JSON
                                </Label>
                                <p className="text-sm text-gray-500">
                                  包含所有信息（状态、熟练度、遇到次数等）
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start space-x-3">
                              <RadioGroupItem
                                value="json-array"
                                id="export-json-array"
                                className="mt-1"
                              />
                              <div className="flex-1">
                                <Label htmlFor="export-json-array" className="font-medium">
                                  简单 JSON 数组
                                </Label>
                                <p className="text-sm text-gray-500">
                                  只包含词根列表，格式：["word1", "word2", ...]
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start space-x-3">
                              <RadioGroupItem value="txt" id="export-txt" className="mt-1" />
                              <div className="flex-1">
                                <Label htmlFor="export-txt" className="font-medium">
                                  纯文本 TXT
                                </Label>
                                <p className="text-sm text-gray-500">
                                  每行一个单词，方便导入其他应用
                                </p>
                              </div>
                            </div>
                          </div>
                        </RadioGroup>
                      </div>

                      {/* 状态筛选（仅对简单格式有效） */}
                      {(exportFormat === 'txt' || exportFormat === 'json-array') && (
                        <div className="space-y-2">
                          <Label>词汇状态筛选</Label>
                          <Select
                            value={exportStatusFilter}
                            onValueChange={(v: any) => setExportStatusFilter(v)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">全部</SelectItem>
                              <SelectItem value="learning">学习中</SelectItem>
                              <SelectItem value="known">已掌握</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-sm text-gray-500">选择要导出的词汇状态类型</p>
                        </div>
                      )}

                      <Button onClick={exportVocabulary} size="lg" className="w-full">
                        <Download className="mr-2 h-4 w-4" />
                        导出词汇
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* 导入词汇 */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Upload className="mr-2 inline h-5 w-5" />
                      导入词汇
                    </CardTitle>
                    <CardDescription>从JSON文件导入词汇数据</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <p className="text-sm text-gray-600">
                        选择之前导出的JSON文件进行导入。导入的数据会与现有数据合并。
                      </p>
                      <div className="flex items-center gap-4">
                        <Button variant="outline" size="lg" asChild>
                          <label className="cursor-pointer">
                            <Upload className="mr-2 h-4 w-4" />
                            选择JSON文件
                            <input
                              type="file"
                              accept=".json"
                              className="hidden"
                              onChange={handleImport}
                            />
                          </label>
                        </Button>
                        {loading && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            导入中...
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 快速导入预设词库 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Book className="h-5 w-5" />
                      快速导入预设词库
                    </CardTitle>
                    <CardDescription>选择预设词库快速添加到你的学习列表</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <p className="text-sm text-gray-600">
                        预设词库包含常用的学习词汇集合，导入后会自动标记为"已掌握"状态。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {presetLists.map((list) => (
                          <Button
                            key={list.key}
                            variant="secondary"
                            size="lg"
                            onClick={() => addPresetVocabulary(list.key)}
                            disabled={loading}
                            title={list.description}
                          >
                            {list.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'vocabulary-ignored' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-3xl font-bold text-gray-900">忽略列表</h2>
                  <p className="mt-2 text-gray-600">管理你不想高亮显示的词汇</p>
                </div>

                {/* 忽略列表管理 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Ban className="h-5 w-5" />
                      忽略列表管理
                    </CardTitle>
                    <CardDescription>
                      这些词汇不会在页面上被高亮显示。在词汇卡片中点击"忽略"按钮可以添加到此列表。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {ignoredWordsLoading ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin" />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {ignoredWords.length === 0 ? (
                          <p className="italic text-gray-500">暂无忽略的词汇</p>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <p className="text-sm text-gray-600">
                                共 {ignoredWords.length} 个忽略的词汇
                              </p>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={clearIgnoredWords}
                                disabled={ignoredWords.length === 0}
                              >
                                清空列表
                              </Button>
                            </div>
                            <ScrollArea className="h-48 rounded-md border p-4">
                              <div className="flex flex-wrap gap-2">
                                {ignoredWords.map((word) => (
                                  <Badge
                                    key={word}
                                    variant="secondary"
                                    className="cursor-pointer hover:bg-red-100"
                                    onClick={() => removeIgnoredWord(word)}
                                  >
                                    {word}
                                    <span className="ml-1">×</span>
                                  </Badge>
                                ))}
                              </div>
                            </ScrollArea>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* 保存按钮 */}
                <div className="flex justify-end">
                  <Button onClick={saveSettings} size="lg">
                    保存设置
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'features' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-3xl font-bold text-gray-900">功能配置</h2>
                  <p className="mt-2 text-gray-600">配置扩展的各项功能和行为</p>
                </div>

                {/* 核心功能 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-5 w-5" />
                      核心功能开关
                    </CardTitle>
                    <CardDescription>控制插件的基础功能启用状态</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <Label htmlFor="extension-enabled" className="font-medium">
                          插件总开关
                        </Label>
                        <p className="text-sm text-gray-500">
                          关闭后，插件的所有功能将被禁用，包括快捷键拦截
                        </p>
                      </div>
                      <Switch
                        id="extension-enabled"
                        checked={settings.extensionEnabled}
                        onCheckedChange={(checked) =>
                          setSettings((prev) => ({ ...prev, extensionEnabled: checked }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t">
                      <div className="flex-1">
                        <Label htmlFor="highlight-enabled" className="font-medium">
                          单词高亮显示
                        </Label>
                        <p className="text-sm text-gray-500">
                          关闭后，页面上不会显示单词高亮，但仍可通过 Alt+点击 查词
                        </p>
                      </div>
                      <Switch
                        id="highlight-enabled"
                        checked={settings.highlightEnabled}
                        onCheckedChange={(checked) =>
                          setSettings((prev) => ({ ...prev, highlightEnabled: checked }))
                        }
                        disabled={!settings.extensionEnabled}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* 单词交互设置 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="h-5 w-5" />
                      单词交互设置
                    </CardTitle>
                    <CardDescription>配置单词卡片显示和熟练度管理</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 卡片显示设置 */}
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <Label htmlFor="show-familiarity" className="font-medium">
                          显示熟练度进度条
                        </Label>
                        <p className="text-sm text-gray-500">
                          在单词卡片中显示熟练度，并支持通过滑块直接调整
                        </p>
                      </div>
                      <Switch
                        id="show-familiarity"
                        checked={settings.showFamiliarityInCard}
                        onCheckedChange={(checked) =>
                          setSettings((prev) => ({ ...prev, showFamiliarityInCard: checked }))
                        }
                      />
                    </div>

                    {/* 熟练度自动提升 */}
                    <div className="flex items-center justify-between pt-4 border-t">
                      <div className="flex-1">
                        <Label htmlFor="auto-increase" className="font-medium">
                          自动提升熟练度
                        </Label>
                        <p className="text-sm text-gray-500">
                          每次查询单词时自动提高一个熟练度等级（最高 7 格）
                        </p>
                      </div>
                      <Switch
                        id="auto-increase"
                        checked={settings.autoIncreaseFamiliarity}
                        onCheckedChange={(checked) =>
                          setSettings((prev) => ({ ...prev, autoIncreaseFamiliarity: checked }))
                        }
                      />
                    </div>

                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 mt-4">
                      <div className="flex gap-2 text-sm text-blue-800">
                        <Info className="h-5 w-5 flex-shrink-0" />
                        <p>
                          提示：熟练度达到最高（7格）时，不会自动转换为"已掌握"状态，仍需手动点击"已掌握"按钮确认。
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* AI 智能功能 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      AI 智能功能
                    </CardTitle>
                    <CardDescription>配置 AI 辅助学习功能</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* AI 模式选择 */}
                    <div>
                      <Label className="font-medium mb-3 block">AI 解析模式</Label>
                      <RadioGroup
                        value={settings.aiMode}
                        onValueChange={(v: any) => setSettings((prev) => ({ ...prev, aiMode: v }))}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-gray-50 transition-colors">
                            <RadioGroupItem value="auto" id="auto" className="mt-1" />
                            <div className="flex-1">
                              <Label htmlFor="auto" className="font-medium cursor-pointer">
                                自动解析（推荐）
                              </Label>
                              <p className="text-sm text-gray-500 mt-0.5">
                                点击单词后立即调用 AI 进行深度分析和解释
                              </p>
                            </div>
                          </div>
                          <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-gray-50 transition-colors">
                            <RadioGroupItem value="manual" id="manual" className="mt-1" />
                            <div className="flex-1">
                              <Label htmlFor="manual" className="font-medium cursor-pointer">
                                手动触发
                              </Label>
                              <p className="text-sm text-gray-500 mt-0.5">
                                显示卡片后，需要点击 "✨ AI 解析" 按钮来调用 AI
                              </p>
                            </div>
                          </div>
                          <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-gray-50 transition-colors">
                            <RadioGroupItem value="off" id="off" className="mt-1" />
                            <div className="flex-1">
                              <Label htmlFor="off" className="font-medium cursor-pointer">
                                关闭 AI
                              </Label>
                              <p className="text-sm text-gray-500 mt-0.5">
                                不使用 AI 功能，仅显示基础词汇信息和词典释义
                              </p>
                            </div>
                          </div>
                        </div>
                      </RadioGroup>
                    </div>

                    {/* AI 增强功能 */}
                    <div className="pt-6 border-t space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <Label htmlFor="enhanced-phrase" className="font-medium">
                            增强词组检测
                          </Label>
                          <p className="text-sm text-gray-500 mt-1">
                            识别连字符词组（如
                            old-fashioned）和固定搭配，提供更完整的解释（会略微增加响应时间）
                          </p>
                        </div>
                        <Switch
                          id="enhanced-phrase"
                          checked={settings.enhancedPhraseDetection}
                          onCheckedChange={(checked) =>
                            setSettings((prev) => ({ ...prev, enhancedPhraseDetection: checked }))
                          }
                        />
                      </div>
                    </div>

                    {/* 长难句分析 */}
                    <div className="pt-6 border-t space-y-3">
                      <div>
                        <Label className="font-medium">长难句智能分析</Label>
                        <p className="text-sm text-gray-500 mt-1">
                          使用 Alt+Shift+点击 单词时，对所在句子进行语法结构分析
                        </p>
                      </div>
                      <RadioGroup
                        value={settings.sentenceAnalysisMode}
                        onValueChange={(value: 'always' | 'smart' | 'off') =>
                          setSettings((prev) => ({ ...prev, sentenceAnalysisMode: value }))
                        }
                      >
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="always" id="analysis-always" />
                            <Label
                              htmlFor="analysis-always"
                              className="font-normal cursor-pointer text-sm"
                            >
                              始终分析 - 每次都进行句子结构分析
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="smart" id="analysis-smart" />
                            <Label
                              htmlFor="analysis-smart"
                              className="font-normal cursor-pointer text-sm"
                            >
                              智能判断 - 自动识别长难句并分析（推荐）
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="off" id="analysis-off" />
                            <Label
                              htmlFor="analysis-off"
                              className="font-normal cursor-pointer text-sm"
                            >
                              关闭分析 - 只翻译句子，不进行结构分析
                            </Label>
                          </div>
                        </div>
                      </RadioGroup>
                    </div>
                  </CardContent>
                </Card>

                {/* 保存按钮 */}
                <div className="flex justify-end">
                  <Button onClick={saveSettings} size="lg">
                    保存设置
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'article-analysis' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-3xl font-bold text-gray-900">文章难度分析（BETA）</h2>
                  <p className="mt-2 text-gray-600">
                    输入一篇英文文章，分析其对你的难度，帮助你了解哪些单词需要学习
                  </p>
                </div>

                {/* 文章输入 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      输入文章内容
                    </CardTitle>
                    <CardDescription>粘贴你想分析的英文文章</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="article-text">文章内容</Label>
                      <textarea
                        id="article-text"
                        className="mt-2 w-full rounded-md border border-gray-300 p-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                        rows={12}
                        value={articleText}
                        onChange={(e) => setArticleText(e.target.value)}
                        placeholder="在此处粘贴英文文章内容..."
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setArticleText('');
                          setAnalysisResult(null);
                        }}
                        disabled={analyzing || !articleText}
                      >
                        清空
                      </Button>
                      <Button onClick={analyzeArticle} disabled={analyzing || !articleText}>
                        {analyzing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {analyzing ? '分析中...' : '开始分析'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* 分析结果 */}
                {analysisResult && (
                  <>
                    {/* 统计概览 */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <BarChart3 className="h-5 w-5" />
                          分析结果
                        </CardTitle>
                        <CardDescription>文章词汇统计和难度分析</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                          <div className="rounded-lg border p-4">
                            <div className="text-2xl font-bold text-gray-900">
                              {analysisResult.totalWords}
                            </div>
                            <div className="text-sm text-gray-600">总词数</div>
                          </div>
                          <div className="rounded-lg border p-4">
                            <div className="text-2xl font-bold text-gray-900">
                              {analysisResult.uniqueWords}
                            </div>
                            <div className="text-sm text-gray-600">不重复词数</div>
                          </div>
                          <div className="rounded-lg border p-4">
                            <div className="text-2xl font-bold text-green-600">
                              {analysisResult.knownWords.length}
                            </div>
                            <div className="text-sm text-gray-600">已掌握</div>
                          </div>
                          <div className="rounded-lg border p-4">
                            <div className="text-2xl font-bold text-blue-600">
                              {analysisResult.learningWords.length}
                            </div>
                            <div className="text-sm text-gray-600">学习中</div>
                          </div>
                          <div className="rounded-lg border p-4">
                            <div className="text-2xl font-bold text-orange-600">
                              {analysisResult.unknownWords.length}
                            </div>
                            <div className="text-sm text-gray-600">陌生词</div>
                          </div>
                          <div className="rounded-lg border p-4">
                            <div className="text-2xl font-bold text-gray-400">
                              {analysisResult.notInDictWords.length}
                            </div>
                            <div className="text-sm text-gray-600">不在词库</div>
                          </div>
                          <div className="rounded-lg border bg-blue-50 p-4 md:col-span-2">
                            <div className="text-2xl font-bold text-blue-900">
                              {analysisResult.uniqueWords > 0
                                ? (
                                    ((analysisResult.knownWords.length +
                                      analysisResult.learningWords.length) /
                                      analysisResult.uniqueWords) *
                                    100
                                  ).toFixed(1)
                                : 0}
                              %
                            </div>
                            <div className="text-sm text-blue-800">熟悉度</div>
                          </div>
                        </div>

                        {/* 难度评估 */}
                        <div className="mt-6 rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
                          <h3 className="font-semibold text-blue-900 flex items-center gap-2">
                            <Activity className="h-5 w-5" />
                            难度评估
                          </h3>
                          <p className="mt-1 text-sm text-blue-800">
                            {(() => {
                              const familiarRate =
                                ((analysisResult.knownWords.length +
                                  analysisResult.learningWords.length) /
                                  analysisResult.uniqueWords) *
                                100;
                              if (familiarRate >= 95) {
                                return '这篇文章对你来说非常简单，可以轻松阅读。';
                              } else if (familiarRate >= 85) {
                                return '这篇文章对你来说比较容易，适合流畅阅读。';
                              } else if (familiarRate >= 70) {
                                return '这篇文章有一定难度，但适合作为学习材料。';
                              } else if (familiarRate >= 50) {
                                return '这篇文章较难，建议先学习一些关键词汇。';
                              } else {
                                return '这篇文章非常有挑战性，建议从更基础的材料开始。';
                              }
                            })()}
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* 词汇详情 */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Book className="h-5 w-5" />
                          词汇详情
                        </CardTitle>
                        <CardDescription>各类词汇的详细列表</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* 陌生词 */}
                        {analysisResult.unknownWords.length > 0 && (
                          <div>
                            <h3 className="mb-2 font-semibold text-orange-700 flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full bg-orange-500"></div>
                              陌生词 ({analysisResult.unknownWords.length})
                            </h3>
                            <ScrollArea className="h-32 rounded-md border p-4">
                              <div className="flex flex-wrap gap-2">
                                {analysisResult.unknownWords.map((word) => (
                                  <Badge
                                    key={word}
                                    className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300"
                                  >
                                    {word}
                                  </Badge>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        )}

                        {/* 学习中 */}
                        {analysisResult.learningWords.length > 0 && (
                          <div>
                            <h3 className="mb-2 font-semibold text-blue-700 flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                              学习中 ({analysisResult.learningWords.length})
                            </h3>
                            <ScrollArea className="h-32 rounded-md border p-4">
                              <div className="flex flex-wrap gap-2">
                                {analysisResult.learningWords.map((word) => (
                                  <Badge
                                    key={word}
                                    className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                                  >
                                    {word}
                                  </Badge>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        )}

                        {/* 已掌握 */}
                        {analysisResult.knownWords.length > 0 && (
                          <div>
                            <h3 className="mb-2 font-semibold text-green-700 flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full bg-green-500"></div>
                              已掌握 ({analysisResult.knownWords.length})
                            </h3>
                            <ScrollArea className="h-32 rounded-md border p-4">
                              <div className="flex flex-wrap gap-2">
                                {analysisResult.knownWords.map((word) => (
                                  <Badge
                                    key={word}
                                    className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                                  >
                                    {word}
                                  </Badge>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        )}

                        {/* 不在词库 */}
                        {analysisResult.notInDictWords.length > 0 && (
                          <div>
                            <h3 className="mb-2 font-semibold text-gray-600 flex items-center gap-2">
                              <div className="h-3 w-3 rounded-full bg-gray-400"></div>
                              不在词库 ({analysisResult.notInDictWords.length})
                            </h3>
                            <p className="mb-2 text-sm text-gray-500">
                              这些词可能是专有名词、俚语或不常见的词汇
                            </p>
                            <ScrollArea className="h-32 rounded-md border p-4">
                              <div className="flex flex-wrap gap-2">
                                {analysisResult.notInDictWords.map((word) => (
                                  <Badge key={word} variant="secondary" className="text-gray-600">
                                    {word}
                                  </Badge>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
