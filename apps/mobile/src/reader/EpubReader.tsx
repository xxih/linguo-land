/**
 * EPUB 阅读器：复用 @epubjs-react-native/core 的 WebView 渲染保留原书排版，
 * 通过 injectedJavascript 把 epub.js iframe 内的 click 事件转译成"取词"消息回到 RN。
 *
 * 单击 → caretRangeFromPoint 找到点击位置 → 用 \b 在文本节点里抓出该词 → 高亮 + postMessage
 *
 * 进度：epub.js 的 location.start.cfi 字符串作为 locator
 */
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import {
  Reader,
  ReaderProvider,
  useReader,
  type Theme,
  type Location,
} from '@epubjs-react-native/core';
import { useFileSystem } from '@epubjs-react-native/expo-file-system';
import { createLogger } from '../utils/logger';

const log = createLogger('EpubReader');

interface Props {
  src: string; // 本地缓存 file:// URI（reader[id].tsx 已经先 download 过）
  initialLocation?: string; // CFI
  onLocationChange?: (cfi: string, percent: number) => void;
  onWordPress: (word: string, sentence: string) => void;
  /** 字号（px），由阅读器顶栏设置 */
  fontSize?: number;
}

const defaultTheme: Theme = {
  body: { background: '#ffffff', color: '#111827' },
  p: { 'line-height': '1.6' },
  'span.linguoland-tap': {
    background: 'rgba(245, 158, 11, 0.25)',
    'border-radius': '2px',
  },
};

/**
 * 注入到 epub.js 渲染 iframe 内的脚本：
 * - 单击监听
 * - 取词（caretRangeFromPoint）
 * - 高亮已点选的词
 * - 通过 ReactNativeWebView.postMessage 把 word/sentence 回传
 */
const TAP_INJECT = `
(function() {
  if (window.__linguoland_injected) return;
  window.__linguoland_injected = true;

  function findWord(node, offset) {
    if (!node || node.nodeType !== 3) return null;
    const text = node.nodeValue || '';
    let start = offset, end = offset;
    while (start > 0 && /[\\p{Letter}'’\\-]/u.test(text[start - 1])) start--;
    while (end < text.length && /[\\p{Letter}'’\\-]/u.test(text[end])) end++;
    if (start === end) return null;
    return { word: text.slice(start, end), node, start, end };
  }

  function findSentence(node, anchor) {
    let n = node;
    while (n && n.nodeType !== 1) n = n.parentNode;
    const root = n && n.closest && (n.closest('p,li,blockquote,td,h1,h2,h3,h4,h5,h6') || n);
    return (root && root.textContent ? root.textContent.replace(/\\s+/g, ' ').trim() : '');
  }

  function clearTap() {
    document.querySelectorAll('span.linguoland-tap').forEach(function(s) {
      const parent = s.parentNode;
      while (s.firstChild) parent.insertBefore(s.firstChild, s);
      parent.removeChild(s);
      parent.normalize();
    });
  }

  function highlight(node, start, end) {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const span = document.createElement('span');
    span.className = 'linguoland-tap';
    range.surroundContents(span);
  }

  document.addEventListener('click', function(e) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(e.clientX, e.clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }
    if (!range) return;
    const found = findWord(range.startContainer, range.startOffset);
    if (!found) return;
    clearTap();
    try { highlight(found.node, found.start, found.end); } catch (err) { /* 忽略嵌入式标签穿越导致的错误 */ }
    const sentence = findSentence(found.node, found);
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'linguoland.tap',
      word: found.word,
      sentence: sentence
    }));
  }, true);
})();
true;
`;

function InnerReader({
  src,
  initialLocation,
  onLocationChange,
  onWordPress,
  fontSize = 18,
}: Props) {
  const { changeFontSize } = useReader();

  useEffect(() => {
    changeFontSize(`${fontSize}px`);
  }, [fontSize, changeFontSize]);

  const handleMessage = useMemo(
    () => (event: { nativeEvent?: { data?: string } } | string) => {
      const raw =
        typeof event === 'string' ? event : event?.nativeEvent?.data ?? '';
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.type === 'linguoland.tap' && typeof parsed.word === 'string') {
          onWordPress(
            parsed.word,
            typeof parsed.sentence === 'string' ? parsed.sentence : '',
          );
        }
      } catch {
        // 非我们的消息，忽略
      }
    },
    [onWordPress],
  );

  return (
    <Reader
      src={src}
      fileSystem={useFileSystem}
      initialLocation={initialLocation}
      defaultTheme={defaultTheme}
      enableSwipe
      injectedJavascript={TAP_INJECT}
      onWebViewMessage={handleMessage}
      onLocationChange={(
        _total: number,
        current: Location,
        _progress: number,
      ) => {
        const cfi = current?.start?.cfi ?? '';
        const percent = current?.start?.percentage ?? 0;
        if (cfi) onLocationChange?.(cfi, percent);
      }}
      renderLoadingFileComponent={() => (
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator />
        </View>
      )}
    />
  );
}

export function EpubReader(props: Props) {
  return (
    <ReaderProvider>
      <View className="flex-1 bg-white">
        <InnerReader {...props} />
      </View>
    </ReaderProvider>
  );
}
