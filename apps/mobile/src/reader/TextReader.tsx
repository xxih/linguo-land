/**
 * 纯文本阅读器：服务端流回 .txt → 这里渲染段落 + 单击 token 查词。
 *
 * 进度模型：locator = "<chapterIdx>:<charOffset>"。v1 chapterIdx 恒为 0（TXT 不切章），
 * charOffset 是当前最顶端可见 token 的 offset。
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { tokenize, splitParagraphs, type Token } from './tokenize';
import type { WordFamilyInfo } from 'shared-types';
import { vocabularyApi } from '../lib/api-endpoints';
import { createLogger } from '../utils/logger';

const log = createLogger('TextReader');

interface Props {
  /** 整篇 TXT 文本（已下载） */
  text: string;
  /** 初始进度的 charOffset（来自 ReadingProgress.locator） */
  initialCharOffset?: number;
  /** 单击词回调（reader 上层弹 WordCard） */
  onWordPress: (word: string, paragraphContext: string) => void;
  /** 翻页 / 阅读位置变化时上报 charOffset，由父级节流后写后端 */
  onProgressChange: (charOffset: number, percent: number) => void;
  /** 词族状态变化时父级重渲，本组件订阅以更新高亮 */
  familyMap: Record<string, WordFamilyInfo>;
}

interface Paragraph {
  text: string;
  baseOffset: number;
  tokens: Token[];
}

const TONE_BG: Record<WordFamilyInfo['status'], string> = {
  unknown: 'bg-blue-100',
  learning: 'bg-amber-100',
  known: '',
};

export function TextReader({
  text,
  initialCharOffset = 0,
  onWordPress,
  onProgressChange,
  familyMap,
}: Props) {
  const paragraphs = useMemo<Paragraph[]>(() => {
    const parts = splitParagraphs(text);
    let off = 0;
    const out: Paragraph[] = [];
    for (const p of parts) {
      out.push({ text: p, baseOffset: off, tokens: tokenize(p, off) });
      off += p.length + 2; // 加回 \n\n 的长度
    }
    return out;
  }, [text]);

  const totalChars = text.length || 1;
  const listRef = useRef<FlatList<Paragraph>>(null);
  const [ready, setReady] = useState(false);

  // 初次渲染滚到 initialCharOffset 所在段落
  useEffect(() => {
    if (paragraphs.length === 0) return;
    const idx = paragraphs.findIndex((p, i) => {
      const next = paragraphs[i + 1];
      return p.baseOffset <= initialCharOffset &&
        (!next || next.baseOffset > initialCharOffset);
    });
    const target = Math.max(0, idx);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: target,
        animated: false,
        viewPosition: 0,
      });
      setReady(true);
    });
  }, [paragraphs, initialCharOffset]);

  const handleViewableChanged = useRef(({ viewableItems }: any) => {
    if (!viewableItems || viewableItems.length === 0) return;
    const top = viewableItems[0];
    const para: Paragraph = top.item;
    const off = para.baseOffset;
    const percent = Math.min(1, off / totalChars);
    onProgressChange(off, percent);
  }).current;

  const renderItem = useCallback(
    ({ item }: { item: Paragraph }) => (
      <ParagraphView
        para={item}
        familyMap={familyMap}
        onWordPress={(w) => onWordPress(w, item.text)}
      />
    ),
    [familyMap, onWordPress],
  );

  if (paragraphs.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-gray-500">文档为空</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {!ready && (
        <View className="absolute inset-0 z-10 bg-white items-center justify-center">
          <ActivityIndicator />
        </View>
      )}
      <FlatList
        ref={listRef}
        data={paragraphs}
        keyExtractor={(_, i) => `p${i}`}
        renderItem={renderItem}
        initialNumToRender={20}
        windowSize={10}
        onViewableItemsChanged={handleViewableChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 30 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
        onScrollToIndexFailed={(info) => {
          // FlatList 还没测出每段高度时，重试
          log.debug('scroll-to-index failed, retry', info.index);
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: false,
            });
          }, 200);
        }}
      />
    </View>
  );
}

function ParagraphView({
  para,
  familyMap,
  onWordPress,
}: {
  para: Paragraph;
  familyMap: Record<string, WordFamilyInfo>;
  onWordPress: (word: string) => void;
}) {
  return (
    <Text className="text-[17px] leading-7 text-gray-900 mb-4">
      {para.tokens.map((tok, i) => {
        if (tok.type !== 'word') {
          return <Text key={i}>{tok.text}</Text>;
        }
        const fam = familyMap[tok.text.toLowerCase()];
        const tone = fam ? TONE_BG[fam.status] : '';
        return (
          <Text
            key={i}
            onPress={() => onWordPress(tok.text)}
            suppressHighlighting
            className={tone ? `${tone}` : ''}
          >
            {tok.text}
          </Text>
        );
      })}
    </Text>
  );
}
