import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { WordFamiliarityStatus } from 'shared-types';
import { vocabularyApi } from '../../../src/lib/api-endpoints';
import { FamiliarityBar } from '../../../src/components/FamiliarityBar';

type StatusFilter = 'all' | WordFamiliarityStatus;

interface Stats {
  unknown: number;
  learning: number;
  known: number;
  total: number;
}

interface Row {
  familyRoot: string;
  status: WordFamiliarityStatus;
  familiarityLevel: number;
  lookupCount?: number;
  lastSeenAt?: string | null;
}

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unknown', label: '不认识' },
  { key: 'learning', label: '学习中' },
  { key: 'known', label: '已掌握' },
];

export default function VocabListScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reloadStats = useCallback(async () => {
    try {
      const s = await vocabularyApi.stats();
      setStats({
        unknown: s.unknown,
        learning: s.learning,
        known: s.known,
        total: s.total,
      });
    } catch {
      /* ignore stats failure，列表还能用 */
    }
  }, []);

  const fetchPage = useCallback(
    async (
      params: {
        page: number;
        filter: StatusFilter;
        search: string;
      },
      reset: boolean,
    ) => {
      const data = await vocabularyApi.list({
        page: params.page,
        limit: 30,
        sortBy: 'lastSeenAt',
        sortOrder: 'desc',
        status: params.filter === 'all' ? undefined : params.filter,
        search: params.search || undefined,
      });
      const list: Row[] = (data?.items ?? data?.data ?? []) as Row[];
      const more =
        list.length === (data?.limit ?? 30) || data?.hasMore === true;
      setItems((prev) => (reset ? list : [...prev, ...list]));
      setHasMore(Boolean(more));
    },
    [],
  );

  useEffect(() => {
    setLoading(true);
    setPage(1);
    setHasMore(true);
    Promise.all([
      reloadStats(),
      fetchPage({ page: 1, filter, search }, true).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [filter, search, fetchPage, reloadStats]);

  const onEndReached = useCallback(async () => {
    if (!hasMore || loading) return;
    const next = page + 1;
    setPage(next);
    fetchPage({ page: next, filter, search }, false).catch(() => {});
  }, [hasMore, loading, page, filter, search, fetchPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    await Promise.all([
      reloadStats(),
      fetchPage({ page: 1, filter, search }, true).catch(() => {}),
    ]);
    setRefreshing(false);
  }, [filter, search, reloadStats, fetchPage]);

  const summary = useMemo(() => {
    if (!stats) return '';
    return `共 ${stats.total} · 不认识 ${stats.unknown} · 学习中 ${stats.learning} · 已掌握 ${stats.known}`;
  }, [stats]);

  return (
    <View className="flex-1 bg-white">
      <View className="px-4 pt-2 pb-1">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="搜索单词…"
          autoCapitalize="none"
          autoCorrect={false}
          className="border border-gray-200 rounded-md px-3 py-2 text-base"
        />
      </View>

      <View className="flex-row gap-2 px-4 py-2">
        {STATUS_TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full ${
              filter === tab.key ? 'bg-blue-600' : 'bg-gray-100'
            }`}
          >
            <Text
              className={
                filter === tab.key
                  ? 'text-white text-xs'
                  : 'text-gray-700 text-xs'
              }
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {summary && (
        <Text className="px-4 pb-2 text-xs text-gray-500">{summary}</Text>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.familyRoot}
          renderItem={({ item }) => <Row row={item} />}
          onEndReachedThreshold={0.4}
          onEndReached={onEndReached}
          ListEmptyComponent={
            <View className="py-16 items-center">
              <Text className="text-gray-400">没有匹配的词</Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
}

function Row({ row }: { row: Row }) {
  return (
    <View className="px-4 py-3 border-b border-gray-100">
      <View className="flex-row justify-between items-baseline mb-1">
        <Text className="text-base font-medium">{row.familyRoot}</Text>
        <Text className="text-xs text-gray-400 capitalize">{row.status}</Text>
      </View>
      <FamiliarityBar value={row.familiarityLevel} status={row.status} size="sm" />
    </View>
  );
}
