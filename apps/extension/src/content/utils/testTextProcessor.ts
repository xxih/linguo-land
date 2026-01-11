// 简化版测试函数，避免环境变量依赖
class Logger {
  static debug(..._args: any[]) {
    // console.log('DEBUG:', ..._args);
  }
  static error(_error: any, ..._args: any[]) {
    console.error('ERROR:', _error, ..._args);
  }
}

class SimpleTextProcessor {
  private static readonly logger = Logger;

  /**
   * 专业分词函数，融合了正则表达式的准确性和 `split-case` 的健壮性。
   * - 正确处理 LLMs, MLPs 等缩写词。
   * - 完全支持 Unicode 字符 (例如: `motÉtat`)。
   * - 能够保留并忽略前后缀特殊字符 (例如: `_myVariable_`)。
   *
   * @param word The string to split.
   * @returns An array of word parts with their positions.
   */
  static splitCamelCase(word: string): { word: string; start: number; end: number }[] {
    if (!word) {
      return [];
    }

    try {
      // 1. 借鉴 `split-case` 的思想，分离前后缀
      let prefixIndex = 0;
      while (prefixIndex < word.length && '_-'.includes(word[prefixIndex])) {
        prefixIndex++;
      }

      let suffixIndex = word.length;
      while (suffixIndex > prefixIndex && '_-'.includes(word[suffixIndex - 1])) {
        suffixIndex--;
      }

      const coreWord = word.slice(prefixIndex, suffixIndex);
      if (!coreWord) {
        // 如果核心部分为空 (例如，输入是 "___")，返回原词
        return [{ word: word, start: 0, end: word.length }];
      }

      // 2. 使用强大的 Unicode 正则表达式在核心部分进行分词
      // \p{Lu}{2,}(?!s\p{Ll})s?: 匹配缩写词 (如 LLMs, HTTP, API)
      // \p{Lu}?\p{Ll}+: 匹配标准单词 (如 Case, case, État)
      // \p{Lu}: 匹配单个大写字母 (后备)
      // \d+: 匹配数字序列
      const regex = /\p{Lu}{2,}(?!s\p{Ll})s?|\p{Lu}?\p{Ll}+|\p{Lu}|\d+/gu;
      const result: { word: string; start: number; end: number }[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(coreWord)) !== null) {
        const matchedWord = match[0];

        result.push({
          word: matchedWord,
          // 关键：将匹配的索引用前缀长度进行偏移，得到在原始字符串中的正确位置
          start: match.index + prefixIndex,
          end: match.index + prefixIndex + matchedWord.length,
        });
      }

      if (result.length === 0) {
        return [{ word: word, start: 0, end: word.length }];
      }

      this.logger.debug('Final word splitting result', {
        originalWord: word,
        parts: result.map((p) => p.word).join(' + '),
      });

      return result;
    } catch (error) {
      this.logger.error('Error during professional word splitting', error as Error, { word });
      return [{ word: word, start: 0, end: word.length }];
    }
  }
}

console.log('--- 核心问题 ---');
// 正确将 LLMs 和 MLPs 识别为整体
console.log('LLMs:', JSON.stringify(SimpleTextProcessor.splitCamelCase('LLMs'), null, 2));
console.log('myLLMs:', JSON.stringify(SimpleTextProcessor.splitCamelCase('myLLMs'), null, 2));
console.log('MLPs:', JSON.stringify(SimpleTextProcessor.splitCamelCase('MLPs'), null, 2));

console.log('\n--- 标准命名风格 ---');
console.log('camelCase:', JSON.stringify(SimpleTextProcessor.splitCamelCase('camelCase'), null, 2));
console.log(
  'PascalCase:',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('PascalCase'), null, 2),
);
console.log(
  'snake_case:',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('snake_case'), null, 2),
);
console.log(
  'kebab-case:',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('kebab-case'), null, 2),
);

console.log('\n--- 复杂情况和缩写 ---');
console.log(
  'HTTPRequester:',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('HTTPRequester'), null, 2),
);
console.log(
  'version2API:',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('version2API'), null, 2),
);
// 这个例子展示了(?!s\p{Ll})的重要性，避免把 SCase 拆成 S 和 Case
console.log(
  'PascalSCase:',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('PascalSCase'), null, 2),
);

console.log('\n--- 借鉴 `split-case` 的优点 ---');
console.log(
  'Unicode 支持 (motÉtat):',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('motÉtat'), null, 2),
);
console.log(
  '前后缀处理 (_my-var_):',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('_my-var_'), null, 2),
);
console.log(
  '仅有前后缀 (___):',
  JSON.stringify(SimpleTextProcessor.splitCamelCase('___'), null, 2),
);

console.log('\n--- 特殊测试用例 ---');
console.log('HTML:', JSON.stringify(SimpleTextProcessor.splitCamelCase('HTML'), null, 2));
console.log('URLs:', JSON.stringify(SimpleTextProcessor.splitCamelCase('URLs'), null, 2));
console.log('LLMsAI:', JSON.stringify(SimpleTextProcessor.splitCamelCase('LLMsAI'), null, 2));
console.log('APIs:', JSON.stringify(SimpleTextProcessor.splitCamelCase('APIs'), null, 2));
console.log('CSS3:', JSON.stringify(SimpleTextProcessor.splitCamelCase('CSS3'), null, 2));
