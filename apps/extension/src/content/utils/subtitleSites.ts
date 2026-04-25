/**
 * 字幕站点适配配置。
 *
 * 把站点专属的 DOM 选择器抽出来，新增站点只需在 SITES 数组追加一项；
 * MutationObserver 调用方不再硬编码 YouTube / Netflix。
 *
 * 后续要做"用户自配 / 远端下发"再把 SITES 来源换成异步加载即可，调用 API 不变。
 */

export interface SubtitleSite {
  /** 仅用于日志/调试 */
  name: string;
  /**
   * 元素自身 / 祖先链命中其中任一选择器即视为字幕元素。
   * 用 CSS selector 而不是 className 字符串：可表达 attr / id / 复合选择器。
   */
  matchSelectors: string[];
  /**
   * 字幕容器选择器，按优先级从特定到通用。匹配 `el.closest(selector)` 第一个命中即返回。
   * 字幕容器是高亮触发增量扫描时使用的最小子树根。
   */
  containerSelectors: string[];
}

/**
 * 追加新站点示例（Bilibili / Coursera / TED 等）：
 *
 *   {
 *     name: 'Bilibili',
 *     matchSelectors: ['.bpx-player-subtitle-panel-text', '.bpx-player-subtitle-panel'],
 *     containerSelectors: ['.bpx-player-subtitle-panel'],
 *   }
 */
export const SUBTITLE_SITES: SubtitleSite[] = [
  {
    name: 'YouTube',
    matchSelectors: [
      '.ytp-caption-segment',
      '.captions-text',
      '.caption-visual-line',
      '.caption-window',
      '.ytp-caption-window-container',
    ],
    containerSelectors: ['.caption-window', '.captions-text'],
  },
  {
    name: 'Netflix',
    matchSelectors: ['.player-timedtext', '.player-timedtext-text-container'],
    containerSelectors: ['.player-timedtext-text-container', '.player-timedtext'],
  },
];

/**
 * 通用兜底关键词：站点没明确适配时，靠 className 包含这些词推断是字幕。
 */
const GENERIC_SUBTITLE_KEYWORDS = ['caption', 'subtitle', 'sub-title'];

/** 元素自身或祖先链是否命中已知字幕站点。 */
export function isSubtitleElement(element: HTMLElement): boolean {
  for (const site of SUBTITLE_SITES) {
    for (const selector of site.matchSelectors) {
      if (element.matches(selector) || element.closest(selector)) {
        return true;
      }
    }
  }

  // 通用兜底：className 包含 caption / subtitle 关键词
  const classNames = element.className.toString().toLowerCase();
  return GENERIC_SUBTITLE_KEYWORDS.some((kw) => classNames.includes(kw));
}

/**
 * 取字幕的"扫描根"——按站点优先级 closest 第一个命中的容器，否则元素自身（若它是字幕段）。
 */
export function getSubtitleContainer(element: HTMLElement): HTMLElement | null {
  for (const site of SUBTITLE_SITES) {
    for (const selector of site.containerSelectors) {
      const container = element.closest(selector);
      if (container) return container as HTMLElement;
    }
  }

  // 元素自身是某个站点已识别的字幕段：直接返回它
  for (const site of SUBTITLE_SITES) {
    for (const selector of site.matchSelectors) {
      if (element.matches(selector)) return element;
    }
  }

  return null;
}
