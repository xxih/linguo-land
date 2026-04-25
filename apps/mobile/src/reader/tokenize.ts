/**
 * 把一段纯文本切成 token 序列：词 / 标点 / 空格 三种类型。
 * 阅读器把 word token 渲染成 Pressable，单击触发查词；punct/space 直接渲染文本。
 *
 * - 词的判定用 \p{Letter} 系列 Unicode 类，覆盖英文 + 重音 + 连字符内嵌词
 * - 连字符词（state-of-the-art）保留为整体一个 word，便于查词
 */
export type TokenType = 'word' | 'punct' | 'space';

export interface Token {
  type: TokenType;
  text: string;
  /** 起点字符偏移（相对整章 / 整段） */
  offset: number;
}

const TOKEN_RE = /(\p{Letter}+(?:['’\-]\p{Letter}+)*)|(\s+)|([^\s\p{Letter}]+)/gu;

export function tokenize(input: string, baseOffset = 0): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(input)) !== null) {
    if (m[1]) tokens.push({ type: 'word', text: m[1], offset: baseOffset + m.index });
    else if (m[2]) tokens.push({ type: 'space', text: m[2], offset: baseOffset + m.index });
    else if (m[3]) tokens.push({ type: 'punct', text: m[3], offset: baseOffset + m.index });
  }
  return tokens;
}

/** 按段落（连续空行）切分 */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
