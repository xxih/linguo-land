import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, Observable } from 'rxjs';
import { AxiosResponse } from 'axios';

export interface AIEnrichmentResponse {
  contextualDefinitions: string[]; // 改为数组以支持多行显示
  exampleSentence: string;
  synonym: string;
}

export interface AITranslationResponse {
  translation: string;
  sentenceAnalysis?: string;
}

export interface AIDefinitionResponse {
  chinese_entries_short: Array<{
    pos: string;
    definitions: string[];
  }>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly apiKey = process.env.DASHSCOPE_API_KEY;
  private readonly apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

  constructor(private readonly httpService: HttpService) {
    if (!this.apiKey) {
      this.logger.error(
        '[ERROR] DASHSCOPE_API_KEY is not set! Please create .env file in apps/server/',
      );
      this.logger.error('        Add this line: DASHSCOPE_API_KEY="your-api-key-here"');
    } else {
      this.logger.log(`[OK] DashScope API initialized with key: ${this.apiKey.substring(0, 8)}...`);
    }
  }

  async getEnrichedDefinition(
    word: string,
    context: string,
    enhancedPhraseDetection: boolean = false,
  ): Promise<AIEnrichmentResponse> {
    // 检查 API Key
    if (!this.apiKey) {
      this.logger.error('Cannot call AI service: DASHSCOPE_API_KEY is not set');
      throw new Error('AI service is not configured. Please set DASHSCOPE_API_KEY in .env file.');
    }

    // 根据是否开启增强检测来构建不同的prompt
    let prompt: string;
    if (enhancedPhraseDetection) {
      prompt = `你是一位专业的英语辅导老师。给定句子"${context}"，需要使用中文解释单词"${word}"。

重要提示：
1. 首先检查句子中是否有包含"${word}"的更完整的表达，例如：
   - 带连字符的复合词（如 old-fashioned, well-known）
   - 固定词组或短语（如 take off, look forward to）
   - 多词表达（如 in spite of, as well as）
   - 其他由多个词组成且意义整体化的表达

2. 如果存在这样的完整表达，请分别解释：
   - **xxxword**: 单词的含义
   - **xxx完整表达**: 完整表达的含义
   （如果两者含义一致，则只返回单词解释）
3. 如果不存在完整表达，则只返回单词"${word}"在句子中的解释。

请使用 Markdown 格式直接输出解释内容，可以使用加粗(**text**)、列表等格式。每个解释简洁清晰，不超过30字。
直接返回 Markdown 文本，不要使用 JSON 格式。`;
    } else {
      prompt = `你是一位专业的英语辅导老师。给定句子"${context}"，
请用简洁、清晰的方式为英语学习者解释单词"${word}"。
根据该单词在句子中的用法，提供一个简短的情境化定义。

请使用 Markdown 格式输出，使用加粗(**text**)突出单词。格式如：**${word}**: 含义说明
用中文回答，不超过30字。
直接返回 Markdown 文本，不要使用 JSON 格式。`;
    }

    const payload = {
      model: 'qwen-flash',
      messages: [
        {
          role: 'system',
          content: '你是一位友好且高效的助手，直接返回简洁的 Markdown 格式内容。',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: enhancedPhraseDetection ? 150 : 100, // 增强模式需要更多tokens
    };

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    try {
      this.logger.debug(`Calling AI service for word: ${word}`);
      const response = await firstValueFrom(
        this.httpService.post(this.apiUrl, payload, { headers }),
      );

      // 直接获取 Markdown 内容
      const content = response.data.choices[0].message.content.trim();
      this.logger.debug(`AI service response received for word: ${word}`);

      // 为了保持接口兼容，包装成数组
      return {
        contextualDefinitions: [content],
        exampleSentence: '', // 保持接口兼容
        synonym: '', // 保持接口兼容
      };
    } catch (error) {
      this.logger.error(
        `AI Service Error for word "${word}":`,
        error.response?.data || error.message,
      );

      // 提供更友好的错误信息
      if (error.response?.data?.error?.code === 'invalid_api_key') {
        throw new Error(
          'Invalid DashScope API key. Please check your DASHSCOPE_API_KEY in .env file.',
        );
      }

      throw new Error(
        `Failed to get AI enrichment: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  async getTranslation(
    sentence: string,
    targetSentence?: string,
    sentenceAnalysisMode: 'always' | 'smart' | 'off' = 'off',
  ): Promise<AITranslationResponse> {
    // 检查 API Key
    if (!this.apiKey) {
      this.logger.error('Cannot call AI service: DASHSCOPE_API_KEY is not set');
      throw new Error('AI service is not configured. Please set DASHSCOPE_API_KEY in .env file.');
    }

    // 根据长难句分析模式构建不同的 Prompt
    let prompt: string;
    let maxTokens = 200;

    if (sentenceAnalysisMode === 'always' && targetSentence) {
      // 始终进行长难句分析
      maxTokens = 500;
      prompt = `你是一位专业的英语教师。现在需要你完成两个任务：

1. 翻译段落：请将以下英文段落翻译成简洁、地道的中文。
   段落："${targetSentence}"

2. 长难句分析：请详细分析以下英文句子的结构，帮助英语学习者理解。
   句子："${targetSentence}"

   请使用 Markdown 格式输出，包含以下分析要点：
   - **句子主干**：主语、谓语、宾语
   - **从句类型**：定语从句、状语从句、名词性从句等
   - **关键结构**：重要的语法结构
   - **连接词和介词短语**：重要的连接成分

   用简洁的中文说明，控制在150字以内。使用 Markdown 列表和加粗格式使内容更清晰。

请将你的回答格式化为一个 JSON 对象，包含两个键：
- translation: 段落的中文翻译（普通文本）
- sentenceAnalysis: 句子的结构分析（Markdown 格式）`;
    } else if (sentenceAnalysisMode === 'smart' && targetSentence) {
      // 智能判断：让 AI 自行决定是否需要分析
      maxTokens = 500;
      prompt = `你是一位专业的英语教师。现在需要你完成以下任务：

1. 翻译段落：请将以下英文段落翻译成简洁、地道的中文。
   段落："${targetSentence}"

2. 长难句分析（智能判断）：请自行判断这个句子是否为长难句，如果是（句子结构复杂、包含多个从句、连接词较多），则提供详细的句子结构分析。如果是简单句子，则不需要分析。
   句子："${targetSentence}"

   如果需要分析，请使用 Markdown 格式输出，包含以下分析要点：
   - **句子主干**：主语、谓语、宾语
   - **从句类型**：定语从句、状语从句、名词性从句等
   - **关键结构**：重要的语法结构
   - **连接词和介词短语**：重要的连接成分

   用简洁的中文说明，控制在150字以内。

请将你的回答格式化为一个 JSON 对象，包含两个键：
- translation: 段落的中文翻译（普通文本）
- sentenceAnalysis: 句子的结构分析Markdown 格式（如果不是长难句则为 null!!!注意！如果不是长难句，直接返回 null）`;
    } else {
      // 只翻译，不分析
      prompt = `你是一个精准、流畅的翻译引擎。请将以下英文句子翻译成简洁、地道的中文。

句子是： "${targetSentence}"

直接返回翻译后的中文文本，不要添加任何额外说明。`;
    }

    const payload = {
      model: 'qwen-flash',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的翻译助手，直接返回简洁的翻译内容。',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    };

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    try {
      this.logger.debug(`Calling AI service for translation: ${sentence.substring(0, 30)}...`);
      const response = await firstValueFrom(
        this.httpService.post(this.apiUrl, payload, { headers }),
      );

      const content = response.data.choices[0].message.content.trim();
      this.logger.debug(`AI translation received.`);

      // 解析内容
      if (sentenceAnalysisMode !== 'off' && targetSentence) {
        // 使用分隔符拆分翻译和分析
        const translationMatch = content.match(/\[翻译\]\s*([\s\S]*?)\s*\[分析\]/);
        const analysisMatch = content.match(/\[分析\]\s*([\s\S]*?)$/);

        return {
          translation: translationMatch ? translationMatch[1].trim() : content,
          sentenceAnalysis: analysisMatch ? analysisMatch[1].trim() : undefined,
        };
      } else {
        return {
          translation: content,
        };
      }
    } catch (error) {
      this.logger.error(`AI Translation Error:`, error.response?.data || error.message);

      // 提供更友好的错误信息
      if (error.response?.data?.error?.code === 'invalid_api_key') {
        throw new Error(
          'Invalid DashScope API key. Please check your DASHSCOPE_API_KEY in .env file.',
        );
      }

      throw new Error(
        `Failed to get AI translation: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }

  /**
   * 流式获取 AI 增强定义
   * @param word 单词
   * @param context 上下文句子
   * @param enhancedPhraseDetection 是否启用增强短语检测
   * @returns Observable 流式响应
   */
  async getEnrichedDefinitionStream(
    word: string,
    context: string,
    enhancedPhraseDetection: boolean = false,
  ): Promise<Observable<AxiosResponse<any>>> {
    if (!this.apiKey) {
      this.logger.error('Cannot call AI service: DASHSCOPE_API_KEY is not set');
      throw new Error('AI service is not configured. Please set DASHSCOPE_API_KEY in .env file.');
    }

    let prompt: string;
    if (enhancedPhraseDetection) {
      prompt = `你是一位专业的英语辅导老师。给定句子"${context}"，需要使用中文解释单词"${word}"。

重要提示：
1. 首先检查句子中是否有包含"${word}"的更完整的表达，例如：
   - 带连字符的复合词（如 old-fashioned, well-known）
   - 固定词组或短语（如 take off, look forward to）
   - 多词表达（如 in spite of, as well as）
   - 其他由多个词组成且意义整体化的表达

2. 如果存在这样的完整表达，请分别解释：
   - **xxxword**: 单词的含义
   - **xxx完整表达**: 完整表达的含义
   （如果两者含义一致，则只返回单词解释）
3. 如果不存在完整表达，则只返回单词"${word}"在句子中的解释。

请使用 Markdown 格式直接输出解释内容，可以使用加粗(**text**)、列表等格式。每个解释简洁清晰，不超过30字。
直接返回 Markdown 文本，不要使用 JSON 格式。`;
    } else {
      prompt = `你是一位专业的英语辅导老师。给定句子"${context}"，
请用简洁、清晰的方式为英语学习者解释单词"${word}"。
根据该单词在句子中的用法，提供一个简短的情境化定义。

请使用 Markdown 格式输出，使用加粗(**text**)突出单词。格式如：**${word}**: 含义说明
用中文回答，不超过30字。
直接返回 Markdown 文本，不要使用 JSON 格式。`;
    }

    const payload = {
      model: 'qwen-flash',
      messages: [
        {
          role: 'system',
          content: '你是一位友好且高效的助手，直接返回简洁的 Markdown 格式内容。',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: enhancedPhraseDetection ? 150 : 100,
      stream: true, // 启用流式输出
      stream_options: { include_usage: true }, // 包含 token 使用信息
    };

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    this.logger.debug(`Starting stream for word: ${word}`);

    return this.httpService.post(this.apiUrl, payload, {
      headers,
      responseType: 'stream',
    });
  }

  /**
   * 流式获取翻译
   * @param sentence 要翻译的句子/段落
   * @param targetSentence 目标句子（用于长难句分析）
   * @param sentenceAnalysisMode 长难句分析模式：always/smart/off
   * @returns Observable 流式响应
   */
  async getTranslationStream(
    sentence: string,
    targetSentence?: string,
    sentenceAnalysisMode: 'always' | 'smart' | 'off' = 'off',
  ): Promise<Observable<AxiosResponse<any>>> {
    if (!this.apiKey) {
      this.logger.error('Cannot call AI service: DASHSCOPE_API_KEY is not set');
      throw new Error('AI service is not configured. Please set DASHSCOPE_API_KEY in .env file.');
    }

    console.log('长难句分析模式：', sentenceAnalysisMode);
    let prompt: string;
    let maxTokens = 200;

    if (sentenceAnalysisMode === 'always' && targetSentence) {
      // 始终进行长难句分析
      maxTokens = 500;
      prompt = `你是一位专业的英语教师。现在需要你完成两个任务：

1. 翻译段落：请将以下英文段落翻译成简洁、地道的中文。
   段落："${targetSentence}"

2. 长难句分析：请详细分析以下英文句子的结构，帮助英语学习者理解。
   句子："${targetSentence}"

   请使用 Markdown 格式输出，包含以下分析要点：
   - **句子主干**：主语、谓语、宾语
   - **从句类型**：定语从句、状语从句、名词性从句等
   - **关键结构**：重要的语法结构
   - **连接词和介词短语**：重要的连接成分

   用简洁的中文说明，控制在150字以内。使用 Markdown 列表和加粗格式使内容更清晰。

请按以下格式输出（直接输出文本，不要使用 JSON）：
[翻译]
翻译内容

[分析]
句子分析内容`;
    } else if (sentenceAnalysisMode === 'smart' && targetSentence) {
      // 智能判断：让 AI 自行决定是否需要分析
      maxTokens = 500;
      prompt = `你是一位专业的英语教师。现在需要你完成以下任务：

1. 翻译段落：请将以下英文段落翻译成简洁、地道的中文。
   段落："${targetSentence}"

2. 长难句分析（智能判断）：请自行判断这个句子是否为长难句，如果是（句子结构复杂、包含多个从句、连接词较多），则提供详细的句子结构分析。如果是简单句子，则不需要分析。
   句子："${targetSentence}"

   如果需要分析，请使用 Markdown 格式输出，包含以下分析要点：
   - **句子主干**：主语、谓语、宾语
   - **从句类型**：定语从句、状语从句、名词性从句等
   - **关键结构**：重要的语法结构
   - **连接词和介词短语**：重要的连接成分

   用简洁的中文说明，控制在150字以内。

请按以下格式输出（直接输出文本，不要使用 JSON）：
[翻译]
翻译内容

[分析]（如果不是长难句，整个分析为空，不需要有任何文字!!!注意！如果不是长难句，直接不要返回这分析）
句子分析内容`;
    } else {
      // 只翻译，不分析
      prompt = `你是一个精准、流畅的翻译引擎。请将以下英文句子翻译成简洁、地道的中文。

句子是： "${sentence}"

直接返回翻译后的中文文本，不要添加任何额外说明。`;
    }

    const payload = {
      model: 'qwen-flash',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的翻译助手，直接返回简洁的翻译内容。',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      stream: true, // 启用流式输出
      stream_options: { include_usage: true }, // 包含 token 使用信息
    };

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    this.logger.debug(`Starting translation stream: ${sentence.substring(0, 30)}...`);

    return this.httpService.post(this.apiUrl, payload, {
      headers,
      responseType: 'stream',
    });
  }

  /**
   * 使用 AI 为单个单词生成中文释义
   * @param word 要查询的单词
   * @returns 符合 chinese_entries_short 格式的对象
   */
  async getDefinitionForWord(word: string): Promise<AIDefinitionResponse> {
    if (!this.apiKey) {
      this.logger.error('Cannot call AI service: DASHSCOPE_API_KEY is not set');
      throw new Error('AI service is not configured.');
    }

    const prompt = `你是一个专业的英汉词典编纂者。请为单词 "${word}" 提供简洁的中文释义。
    你的回答必须是一个符合 TypeScript 接口AIDefinitionResponse的 JSON 对象，具体格式如下：
    { "chinese_entries_short": [ { "pos": "词性", "definitions": ["释义1", "释义2"] } ] }
    请只提供最常见的1到2个词性和对应的释义。如果单词拼写错误或不存在，返回一个空的 chinese_entries_short 数组。`;

    const payload = {
      model: 'qwen-flash',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的词典助手，始终以结构化的 JSON 格式提供精准的回答。',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 150, // 限制 token 数量，加快响应
    };

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    try {
      this.logger.debug(`Calling AI service for dictionary definition: ${word}`);
      const response = await firstValueFrom(
        this.httpService.post(this.apiUrl, payload, { headers }),
      );

      const content = response.data.choices[0].message.content;

      // 增加健壮性：处理 AI 可能返回的非 JSON 或错误格式
      try {
        const result = JSON.parse(content) as AIDefinitionResponse;
        this.logger.debug(`AI definition received for: ${word}`);

        // 验证返回的结构是否正确
        if (result && Array.isArray(result.chinese_entries_short)) {
          return result;
        } else {
          throw new Error('AI returned invalid JSON structure');
        }
      } catch (parseError) {
        this.logger.error(`Failed to parse AI JSON response for "${word}"`, parseError, {
          content,
        });
        // 返回一个空的有效结构
        return { chinese_entries_short: [] };
      }
    } catch (error) {
      this.logger.error(
        `AI Service Error for definition of "${word}":`,
        error.response?.data || error.message,
      );
      throw new Error(
        `Failed to get AI definition: ${error.response?.data?.error?.message || error.message}`,
      );
    }
  }
}
