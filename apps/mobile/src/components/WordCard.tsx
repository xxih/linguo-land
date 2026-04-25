/**
 * 阅读器单击选词后弹出的底部卡片。
 *
 * 流水线：
 * 1. 点选 → 同时发起 dictionary.lookup + vocabulary.query（一次拿释义和已有状态）
 * 2. 卡片底部按钮：unknown / learning / known 切换 + 熟练度滑块
 * 3. AI 增强按需：用户主动点 "AI" 才发 streamEnrichWord，把 contextual definition /
 *    example / synonym 流式打字机到卡片下半部分
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type {
  DictionaryEntry,
  WordFamilyInfo,
  WordFamiliarityStatus,
} from 'shared-types';
import { dictionaryApi, vocabularyApi } from '../lib/api-endpoints';
import { streamEnrichWord, type AiStreamHandle } from '../lib/ai-stream';
import { FamiliarityBar } from './FamiliarityBar';
import { createLogger } from '../utils/logger';

const log = createLogger('WordCard');

interface Props {
  /** 单击的词（原始 surface form，例如 "running"） */
  word: string;
  /** 用于 AI enrich 的上下文段落 */
  context: string;
  onClose: () => void;
  /** 用户改了状态后通知父级（reader 高亮要刷新） */
  onStatusChanged?: (
    word: string,
    family: WordFamilyInfo | null,
  ) => void;
}

const STATUS_TABS: Array<{ key: WordFamiliarityStatus; label: string; tone: string }> = [
  { key: 'unknown', label: '不认识', tone: 'bg-blue-500' },
  { key: 'learning', label: '学习中', tone: 'bg-amber-500' },
  { key: 'known', label: '已掌握', tone: 'bg-gray-400' },
];

export function WordCard({ word, context, onClose, onStatusChanged }: Props) {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [familyInfo, setFamilyInfo] = useState<WordFamilyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [enrichText, setEnrichText] = useState('');
  const [enrichRunning, setEnrichRunning] = useState(false);
  const enrichRef = useRef<AiStreamHandle | null>(null);

  const lower = useMemo(() => word.toLowerCase(), [word]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      dictionaryApi.lookup(lower).catch((e) => {
        log.warn('dict lookup failed', e);
        return null;
      }),
      vocabularyApi.query([lower]).catch((e) => {
        log.warn('vocab query failed', e);
        return {} as Record<string, WordFamilyInfo>;
      }),
    ])
      .then(([dictEntry, vocabResp]) => {
        if (cancelled) return;
        setEntry(dictEntry);
        setFamilyInfo(vocabResp[lower] ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      enrichRef.current?.abort();
    };
  }, [lower]);

  async function changeStatus(next: WordFamiliarityStatus) {
    if (updating) return;
    setUpdating(true);
    try {
      const res = await vocabularyApi.update(lower, {
        status: next,
        familiarityLevel: familyInfo?.familiarityLevel ?? defaultFamiliarity(next),
      });
      if (res.removedFamilyRoot) {
        setFamilyInfo(null);
        onStatusChanged?.(lower, null);
      } else if (res.family) {
        const fi: WordFamilyInfo = {
          familyRoot: res.family.familyRoot,
          status: res.family.status,
          familiarityLevel: res.family.familiarityLevel,
        };
        setFamilyInfo(fi);
        onStatusChanged?.(lower, fi);
      }
    } catch (err) {
      log.error('update status failed', err);
    } finally {
      setUpdating(false);
    }
  }

  async function changeFamiliarity(level: number) {
    if (updating) return;
    setUpdating(true);
    try {
      const res = await vocabularyApi.update(lower, {
        status: familyInfo?.status ?? 'learning',
        familiarityLevel: level,
      });
      if (res.family) {
        const fi: WordFamilyInfo = {
          familyRoot: res.family.familyRoot,
          status: res.family.status,
          familiarityLevel: res.family.familiarityLevel,
        };
        setFamilyInfo(fi);
        onStatusChanged?.(lower, fi);
      }
    } catch (err) {
      log.error('update familiarity failed', err);
    } finally {
      setUpdating(false);
    }
  }

  async function startEnrich() {
    if (enrichRunning) return;
    setEnrichText('');
    setEnrichRunning(true);
    try {
      enrichRef.current = await streamEnrichWord(
        { word: lower, context },
        {
          onChunk: (chunk) => setEnrichText((prev) => prev + chunk),
          onDone: () => setEnrichRunning(false),
          onError: (err) => {
            log.warn('enrich stream error', err.message);
            setEnrichRunning(false);
          },
        },
      );
    } catch (err) {
      log.error('enrich start failed', err);
      setEnrichRunning(false);
    }
  }

  return (
    <View className="bg-white border-t border-gray-200 px-4 pt-4 pb-6 max-h-[60%]">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-2xl font-semibold">{word}</Text>
        <Pressable onPress={onClose} hitSlop={12} className="px-2 py-1">
          <Text className="text-gray-500 text-base">关闭</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="py-6 items-center">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView className="max-h-72" showsVerticalScrollIndicator={false}>
          {entry?.phonetics && entry.phonetics.length > 0 && (
            <Text className="text-gray-500 mb-2">{entry.phonetics.join(' / ')}</Text>
          )}
          {entry ? (
            <DefinitionList entry={entry} />
          ) : (
            <Text className="text-gray-400 italic mb-2">
              字典里没找到这个词。仍可加入生词本或让 AI 帮你解析。
            </Text>
          )}

          {(enrichRunning || enrichText) && (
            <View className="mt-3 p-3 rounded-lg bg-purple-50 border border-purple-100">
              <Text className="text-xs uppercase tracking-wider text-purple-600 mb-1">
                AI 解析
              </Text>
              <Text className="text-base leading-6 text-gray-800">
                {enrichText}
                {enrichRunning && <Text className="text-purple-400">▍</Text>}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <View className="flex-row gap-2 mt-3">
        {STATUS_TABS.map((tab) => {
          const active = familyInfo?.status === tab.key;
          return (
            <Pressable
              key={tab.key}
              disabled={updating}
              onPress={() => changeStatus(tab.key)}
              className={`flex-1 py-2 rounded-md border ${
                active
                  ? `${tab.tone} border-transparent`
                  : 'bg-white border-gray-300'
              }`}
            >
              <Text
                className={`text-center text-sm ${
                  active ? 'text-white font-medium' : 'text-gray-700'
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mt-3">
        <Text className="text-xs text-gray-500 mb-1">
          熟练度 {familyInfo?.familiarityLevel ?? 0}/7
        </Text>
        <FamiliarityBar
          value={familyInfo?.familiarityLevel ?? 0}
          status={familyInfo?.status ?? 'unknown'}
          onChange={changeFamiliarity}
        />
      </View>

      <Pressable
        onPress={startEnrich}
        disabled={enrichRunning}
        className={`mt-3 py-2 rounded-md ${
          enrichRunning ? 'bg-purple-200' : 'bg-purple-600'
        }`}
      >
        <Text className="text-center text-white font-medium">
          {enrichRunning ? 'AI 解析中…' : '让 AI 结合上下文解析'}
        </Text>
      </Pressable>
    </View>
  );
}

function defaultFamiliarity(status: WordFamiliarityStatus): number {
  if (status === 'known') return 7;
  if (status === 'learning') return 3;
  return 0;
}

function DefinitionList({ entry }: { entry: DictionaryEntry }) {
  return (
    <View>
      {(entry.entries ?? []).map((def, defIdx) => (
        <View key={defIdx} className="mb-2">
          <Text className="text-sm text-gray-500 mb-1 italic">{def.pos}</Text>
          {def.senses.map((sense, sIdx) => (
            <View key={sIdx} className="mb-1">
              {(sense.glosses ?? []).map((g, gIdx) => (
                <Text key={gIdx} className="text-base leading-6 text-gray-800">
                  • {g}
                </Text>
              ))}
              {(sense.examples ?? []).slice(0, 1).map((ex, exIdx) => (
                <Text
                  key={exIdx}
                  className="text-sm text-gray-500 italic ml-3 mt-0.5"
                >
                  e.g., {ex}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
