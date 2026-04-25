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
  VocabularySyncResponse,
  WordMutationResponse,
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
    return result;
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
  ): Promise<WordMutationResponse> {
    try {
      const userId = req.user.id;
      const outcome = await this.vocabularyService.updateWordStatus(
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
        family: outcome.kind === 'updated' ? outcome.family : undefined,
        removedFamilyRoot: outcome.kind === 'removed' ? outcome.familyRoot : undefined,
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
  ): Promise<WordMutationResponse> {
    try {
      const userId = req.user.id;
      const outcome = await this.vocabularyService.autoIncreaseFamiliarity(word, userId);
      return {
        success: true,
        message: `Familiarity level increased for word "${word}"`,
        family: outcome.kind === 'updated' ? outcome.family : undefined,
      };
    } catch (error) {
      console.error('[VocabularyController] 自动提升熟练度失败:', error);
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

  // 全量同步：扩展端启动 / 登录时拉一次，用作本地词库镜像。
  // 不分页——一个用户的词族数量级在 1k~10k 间，一次拉完最简单。
  @Get('sync')
  async syncVocabulary(@Request() req): Promise<VocabularySyncResponse> {
    const userId = req.user.id;
    return this.vocabularyService.syncVocabulary(userId);
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
}
