import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Param,
  Query,
  Header,
  StreamableFile,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VocabularyService } from './vocabulary.service';
import { JwtAuthGuard } from './auth/guards';
import type {
  WordQueryRequest,
  WordQueryResponse,
  WordUpdateRequest,
  WordFamiliarityStatus,
} from 'shared-types';

@Controller('api/v1/vocabulary')
@UseGuards(JwtAuthGuard) // 保护整个控制器
export class VocabularyController {
  constructor(private readonly vocabularyService: VocabularyService) {}

  @Post('query')
  async queryWords(@Request() req, @Body() request: WordQueryRequest): Promise<WordQueryResponse> {
    const userId = req.user.id; // 从认证信息中获取用户ID
    const result = await this.vocabularyService.queryWordsStatus(request.words, userId);

    // 注释掉自动添加到词库的逻辑 - 现在需要用户手动添加
    // 异步更新遇到次数（不阻塞响应）
    // request.words.forEach((word) => {
    //   this.vocabularyService
    //     .updateWordEncounter(word, userId)
    //     .catch((err) =>
    //       console.error(`Failed to update encounter for word: ${word}`, err),
    //     );
    // });

    return result;
  }

  @Post('seed')
  async seedSampleData(@Request() req): Promise<{ message: string }> {
    const userId = req.user.id;
    await this.vocabularyService.seedSampleData(userId);
    return { message: 'Sample data seeded successfully' };
  }

  // 通用的预设词库添加接口
  @Post('add-preset/:listKey')
  async addPresetVocabulary(
    @Request() req,
    @Param('listKey') listKey: string,
  ): Promise<{ message: string; count: number }> {
    const userId = req.user.id;
    return this.vocabularyService.addPresetVocabulary(listKey, userId);
  }

  // 获取所有可用的预设词库
  @Get('presets')
  async getAvailablePresets() {
    return this.vocabularyService.getAvailablePresets();
  }

  // 获取所有词汇来源
  @Get('sources')
  async getVocabularySources(@Request() req) {
    const userId = req.user.id;
    return this.vocabularyService.getVocabularySources(userId);
  }

  @Put(':word')
  async updateWordStatus(
    @Request() req,
    @Param('word') word: string,
    @Body() request: WordUpdateRequest,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const userId = req.user.id;
      await this.vocabularyService.updateWordStatus(
        word,
        request.status ?? null,
        userId,
        request.familiarityLevel,
      );

      let message = '';
      if (request.status && request.familiarityLevel !== undefined) {
        message = `Word "${word}" status updated to "${request.status}" with familiarity level ${request.familiarityLevel}`;
      } else if (request.status) {
        message = `Word "${word}" status updated to "${request.status}"`;
      } else if (request.familiarityLevel !== undefined) {
        message = `Word "${word}" familiarity level updated to ${request.familiarityLevel}`;
      }

      return {
        success: true,
        message,
      };
    } catch (error) {
      console.error(`Failed to update word status for: ${word}`, error);
      return {
        success: false,
        message: `Failed to update word status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // 自动提升熟练度接口
  @Post(':word/increase-familiarity')
  async autoIncreaseFamiliarity(
    @Request() req,
    @Param('word') word: string,
  ): Promise<{ success: boolean; message: string }> {
    console.log('[VocabularyController] 收到自动提升熟练度请求');
    console.log('[VocabularyController] 词元:', word);
    console.log('[VocabularyController] 用户ID:', req.user?.id);

    try {
      const userId = req.user.id;
      console.log('[VocabularyController] 调用 service.autoIncreaseFamiliarity');
      await this.vocabularyService.autoIncreaseFamiliarity(word, userId);
      console.log('[VocabularyController] 自动提升熟练度成功');
      return {
        success: true,
        message: `Familiarity level increased for word "${word}"`,
      };
    } catch (error) {
      console.error('[VocabularyController] 自动提升熟练度失败:', error);
      console.error('[VocabularyController] 错误详情:', {
        word,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        message: `Failed to increase familiarity: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  @Get('stats')
  async getVocabularyStats(@Request() req): Promise<{
    unknown: number;
    learning: number;
    known: number;
    total: number;
    recentFamilies: Array<{
      familyRoot: string;
      lastSeenAt: Date;
      lookupCount: number;
    }>;
  }> {
    const userId = req.user.id;
    return this.vocabularyService.getVocabularyStats(userId);
  }

  @Get('list')
  async getAllVocabulary(
    @Request() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy')
    sortBy?: 'familyRoot' | 'status' | 'lastSeenAt' | 'lookupCount' | 'createdAt',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('status') status?: WordFamiliarityStatus,
    @Query('search') search?: string,
    @Query('importSource') importSource?: 'manual' | 'preset' | 'all',
  ) {
    const userId = req.user.id;
    const options = {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      sortBy,
      sortOrder,
      status,
      search,
      importSource,
    };

    return this.vocabularyService.getAllVocabulary(userId, options);
  }

  // 导出词汇为JSON（完整格式）
  @Get('export')
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="vocabulary.json"')
  async exportVocabulary(@Request() req): Promise<StreamableFile> {
    const userId = req.user.id;
    const jsonData = await this.vocabularyService.exportVocabularyToJson(userId);
    return new StreamableFile(Buffer.from(jsonData));
  }

  // 导出词汇为纯文本格式
  @Get('export/txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vocabulary.txt"')
  async exportVocabularyTxt(
    @Request() req,
    @Query('status') status?: WordFamiliarityStatus,
  ): Promise<StreamableFile> {
    const userId = req.user.id;
    const txtData = await this.vocabularyService.exportVocabularyToTxt(userId, status);
    return new StreamableFile(Buffer.from(txtData, 'utf-8'));
  }

  // 导出词汇为简单JSON数组
  @Get('export/json-array')
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="vocabulary-simple.json"')
  async exportVocabularyJsonArray(
    @Request() req,
    @Query('status') status?: WordFamiliarityStatus,
  ): Promise<StreamableFile> {
    const userId = req.user.id;
    const jsonData = await this.vocabularyService.exportVocabularyToJsonArray(userId, status);
    return new StreamableFile(Buffer.from(jsonData));
  }

  // 导入词汇从JSON
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importVocabulary(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ message: string; imported: number; skipped: number }> {
    if (!file) {
      throw new Error('No file uploaded.');
    }
    const userId = req.user.id;
    const jsonContent = file.buffer.toString('utf-8');
    return this.vocabularyService.importVocabularyFromJson(jsonContent, userId);
  }

  @Get('health')
  getHealth(): { status: string } {
    return { status: 'OK' };
  }

  // 获取词族内的所有单词
  @Get('family/:familyRoot')
  async getWordsInFamily(
    @Request() req,
    @Param('familyRoot') familyRoot: string,
  ): Promise<string[]> {
    const userId = req.user.id;
    return this.vocabularyService.getWordsInFamily(familyRoot, userId);
  }

  // 词族管理：从词族中移除单词
  @Post('word/:wordText/remove')
  async removeWordFromFamily(
    @Request() req,
    @Param('wordText') wordText: string,
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.user.id;
    return this.vocabularyService.removeWordFromFamily(wordText, userId);
  }

  // 词族管理：将单词移动到另一个词族
  @Post('word/:wordText/move')
  async moveWordToFamily(
    @Request() req,
    @Param('wordText') wordText: string,
    @Body() body: { newFamilyRoot: string },
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.user.id;
    return this.vocabularyService.moveWordToFamily(wordText, body.newFamilyRoot, userId);
  }

  // 词族管理：从单个单词创建新词族
  @Post('word/:wordText/create-family')
  async createFamilyFromWord(
    @Request() req,
    @Param('wordText') wordText: string,
  ): Promise<{ success: boolean; message: string; familyRoot?: string }> {
    const userId = req.user.id;
    return this.vocabularyService.createFamilyFromWord(wordText, userId);
  }
}
