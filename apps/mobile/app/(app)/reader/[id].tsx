/**
 * 单个文档的阅读屏：根据 fileFormat 分流到 TextReader / EpubReader。
 *
 * - 进入时 GET /documents/:id（拿元信息）+ GET /reading-progress/by-document/:id（拿初始位置）
 * - 阅读中事件触发 progressApi.upsert 节流写后端
 * - 单击词 → 弹 WordCard，关闭后清掉
 * - 维护一个 familyMap（已遇到过的词族状态），WordCard 改了状态后回写它，TextReader 立即重渲高亮
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  DocumentMeta,
  ReadingProgressDto,
  WordFamilyInfo,
} from 'shared-types';
import {
  documentsApi,
  progressApi,
  vocabularyApi,
} from '../../../src/lib/api-endpoints';
import { TextReader } from '../../../src/reader/TextReader';
import { EpubReader } from '../../../src/reader/EpubReader';
import { WordCard } from '../../../src/components/WordCard';
import { readSecure } from '../../../src/lib/secure-storage';
import { ACCESS_TOKEN_KEY, getApiBaseUrl } from '../../../src/lib/api';
import { createLogger } from '../../../src/utils/logger';

const log = createLogger('Reader');

const PROGRESS_THROTTLE_MS = 4000;

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const docId = Number(id);

  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [progress, setProgress] = useState<ReadingProgressDto | null>(null);
  const [txtBody, setTxtBody] = useState<string | null>(null);
  const [epubUrl, setEpubUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [familyMap, setFamilyMap] = useState<Record<string, WordFamilyInfo>>({});
  const [tappedWord, setTappedWord] = useState<{ word: string; sentence: string } | null>(null);

  const lastSyncRef = useRef<{ at: number; locator: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, prog] = await Promise.all([
          documentsApi.get(docId),
          progressApi.get(docId).catch(() => null),
        ]);
        if (cancelled) return;
        setDoc(meta);
        setProgress(prog);

        if (meta.fileFormat === 'TXT') {
          // 直接 fetch 文本
          const baseURL = await getApiBaseUrl();
          const token = await readSecure(ACCESS_TOKEN_KEY);
          const res = await fetch(`${baseURL}/api/v1/documents/${docId}/file`, {
            headers: { Authorization: token ? `Bearer ${token}` : '' },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.text();
          if (!cancelled) setTxtBody(body);
        } else {
          // EPUB：epub.js 接受 URL，但要带 token，所以用预签名思路无奈做不到——
          // 退而求其次：把文件下载到本地缓存，再喂给 reader。
          const baseURL = await getApiBaseUrl();
          const token = await readSecure(ACCESS_TOKEN_KEY);
          const { Paths, File } = await import('expo-file-system');
          const dest = new File(Paths.cache, `linguoland-doc-${docId}.epub`);
          await File.downloadFileAsync(
            `${baseURL}/api/v1/documents/${docId}/file`,
            dest,
            { headers: { Authorization: token ? `Bearer ${token}` : '' } },
          );
          if (!cancelled) setEpubUrl(dest.uri);
        }
      } catch (err: any) {
        Alert.alert('加载失败', err?.message ?? '', [
          { text: '返回', onPress: () => router.back() },
        ]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, router]);

  // 把当前章节出现过的词集合做一次 vocab.query，初始化 familyMap，让 TextReader 高亮已知词
  useEffect(() => {
    if (!txtBody) return;
    const sample = Array.from(
      new Set(
        txtBody
          .toLowerCase()
          .match(/\b\p{Letter}{2,}\b/gu)
          ?.slice(0, 800) ?? [],
      ),
    );
    if (sample.length === 0) return;
    vocabularyApi
      .query(sample)
      .then((map) => setFamilyMap((prev) => ({ ...prev, ...map })))
      .catch((err) => log.warn('init familyMap query failed', err));
  }, [txtBody]);

  const sendProgress = useCallback(
    async (locator: string, percent: number) => {
      try {
        await progressApi.upsert({ documentId: docId, locator, percent });
      } catch (err) {
        log.warn('progress upsert failed', err);
      }
    },
    [docId],
  );

  const onProgress = useCallback(
    (locator: string, percent: number) => {
      const now = Date.now();
      const last = lastSyncRef.current;
      if (last && last.locator === locator) return;
      if (last && now - last.at < PROGRESS_THROTTLE_MS) {
        // 节流但保留最新位置，定时器到时一并发
        lastSyncRef.current = { at: last.at, locator };
        setTimeout(() => {
          const cur = lastSyncRef.current;
          if (cur && cur.locator === locator) {
            sendProgress(locator, percent);
            lastSyncRef.current = { at: Date.now(), locator };
          }
        }, PROGRESS_THROTTLE_MS - (now - last.at));
        return;
      }
      lastSyncRef.current = { at: now, locator };
      sendProgress(locator, percent);
    },
    [sendProgress],
  );

  const initialCharOffset = useMemo(() => {
    if (!progress?.locator) return 0;
    if (progress.locator.includes(':')) {
      const [, off] = progress.locator.split(':');
      const n = Number(off);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }, [progress]);

  const onWordPress = useCallback((word: string, sentence: string) => {
    setTappedWord({ word, sentence });
  }, []);

  const onStatusChanged = useCallback(
    (word: string, family: WordFamilyInfo | null) => {
      setFamilyMap((prev) => {
        const next = { ...prev };
        const lower = word.toLowerCase();
        if (family) next[lower] = family;
        else delete next[lower];
        return next;
      });
    },
    [],
  );

  if (loading || !doc) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center px-4 py-2 border-b border-gray-100">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text className="text-blue-600">‹ 返回</Text>
        </Pressable>
        <Text className="flex-1 text-center text-base font-medium" numberOfLines={1}>
          {doc.title}
        </Text>
        <Text className="text-xs text-gray-400">
          {Math.round((progress?.percent ?? 0) * 100)}%
        </Text>
      </View>

      <View className="flex-1">
        {doc.fileFormat === 'TXT' && txtBody !== null && (
          <TextReader
            text={txtBody}
            initialCharOffset={initialCharOffset}
            familyMap={familyMap}
            onWordPress={onWordPress}
            onProgressChange={(charOffset, percent) =>
              onProgress(`0:${charOffset}`, percent)
            }
          />
        )}
        {doc.fileFormat === 'EPUB' && epubUrl && (
          <EpubReader
            src={epubUrl}
            initialLocation={progress?.locator}
            onLocationChange={(cfi, percent) => onProgress(cfi, percent)}
            onWordPress={onWordPress}
          />
        )}
      </View>

      <Modal
        visible={!!tappedWord}
        animationType="slide"
        transparent
        onRequestClose={() => setTappedWord(null)}
      >
        <Pressable
          className="flex-1 bg-black/30 justify-end"
          onPress={() => setTappedWord(null)}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            {tappedWord && (
              <WordCard
                word={tappedWord.word}
                context={tappedWord.sentence}
                onClose={() => setTappedWord(null)}
                onStatusChanged={onStatusChanged}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
