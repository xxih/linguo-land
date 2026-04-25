/**
 * 书架。系统预置 + 自有文档，按 isPreset 分两组显示，进度条来自 /reading-progress 全量。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { DocumentMeta, ReadingProgressDto } from 'shared-types';
import { documentsApi, progressApi } from '../../src/lib/api-endpoints';
import { useAuthStore } from '../../src/stores/auth';

export default function BookshelfScreen() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [progress, setProgress] = useState<Record<number, ReadingProgressDto>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const logout = useAuthStore((s) => s.logout);
  const userEmail = useAuthStore((s) => s.user?.email);

  const reload = useCallback(async () => {
    try {
      const [docs, progs] = await Promise.all([
        documentsApi.list(),
        progressApi.listAll().catch(() => [] as ReadingProgressDto[]),
      ]);
      setDocuments(docs);
      const map: Record<number, ReadingProgressDto> = {};
      for (const p of progs) map[p.documentId] = p;
      setProgress(map);
    } catch (err: any) {
      Alert.alert('加载失败', err?.message ?? '请检查网络');
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const sections = useMemo(() => {
    const presets = documents.filter((d) => d.isPreset);
    const own = documents.filter((d) => !d.isPreset);
    const out: Array<{ section: string; items: DocumentMeta[] }> = [];
    if (presets.length) out.push({ section: '系统精选', items: presets });
    out.push({ section: '我的文档', items: own });
    return out;
  }, [documents]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <FlatList
        data={sections}
        keyExtractor={(s) => s.section}
        ListHeaderComponent={
          <View className="px-5 pt-3 pb-1 flex-row justify-between items-center">
            <Text className="text-xs text-gray-400">{userEmail}</Text>
            <View className="flex-row gap-3">
              <Pressable onPress={() => router.push('/(app)/vocab')}>
                <Text className="text-blue-600 text-sm">生词本</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/(app)/settings')}>
                <Text className="text-blue-600 text-sm">设置</Text>
              </Pressable>
            </View>
          </View>
        }
        ListFooterComponent={
          <View className="p-5">
            <Pressable
              onPress={() => router.push('/(app)/upload')}
              className="py-3 rounded-md bg-blue-600"
            >
              <Text className="text-center text-white font-medium">+ 上传文档</Text>
            </Pressable>
            <Pressable onPress={logout} className="mt-6 py-2">
              <Text className="text-center text-gray-400 text-xs">登出</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <View className="mb-4">
            <Text className="px-5 text-sm font-semibold text-gray-500 mb-2">
              {item.section}
            </Text>
            {item.items.length === 0 && (
              <Text className="px-5 text-sm text-gray-400">还没有文档</Text>
            )}
            {item.items.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                progress={progress[doc.id]}
                onOpen={() =>
                  router.push({ pathname: '/(app)/reader/[id]', params: { id: String(doc.id) } })
                }
                onDelete={
                  doc.isPreset
                    ? undefined
                    : async () => {
                        try {
                          await documentsApi.delete(doc.id);
                          await reload();
                        } catch (err: any) {
                          Alert.alert('删除失败', err?.message ?? '');
                        }
                      }
                }
              />
            ))}
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      />
    </View>
  );
}

function DocumentRow({
  doc,
  progress,
  onOpen,
  onDelete,
}: {
  doc: DocumentMeta;
  progress?: ReadingProgressDto;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const pct = Math.round(((progress?.percent ?? 0) * 100));
  const sizeKb = Math.max(1, Math.round(doc.sizeBytes / 1024));
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={
        onDelete
          ? () =>
              Alert.alert('删除文档', `要删除 "${doc.title}" 吗？`, [
                { text: '取消', style: 'cancel' },
                { text: '删除', style: 'destructive', onPress: onDelete },
              ])
          : undefined
      }
      className="px-5 py-3 active:bg-gray-50"
    >
      <View className="flex-row justify-between items-baseline">
        <Text className="text-base font-medium text-gray-900 flex-1" numberOfLines={1}>
          {doc.title}
        </Text>
        <Text className="text-xs text-gray-400 ml-3">{doc.fileFormat} · {sizeKb}KB</Text>
      </View>
      {doc.author && (
        <Text className="text-xs text-gray-500 mt-0.5" numberOfLines={1}>
          {doc.author}
        </Text>
      )}
      <View className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
        <View
          className="h-1 bg-blue-500"
          style={{ width: `${pct}%` }}
        />
      </View>
      {pct > 0 && (
        <Text className="text-xs text-gray-400 mt-1">已读 {pct}%</Text>
      )}
    </Pressable>
  );
}
