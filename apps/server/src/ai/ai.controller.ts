import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  HttpException,
  HttpStatus,
  Res,
  Req,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards';
import { EnrichDto } from './dto/enrich.dto';
import { TranslateDto } from './dto/translate.dto';

@Controller('api/v1/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly aiService: AiService) {}

  @Post('enrich')
  async enrichWord(@Body() body: EnrichDto) {
    try {
      this.logger.log(
        `Enriching word "${body.word}" with context: ${body.context.substring(0, 50)}... (enhanced: ${body.enhancedPhraseDetection || false})`,
      );
      const result = await this.aiService.getEnrichedDefinition(
        body.word,
        body.context,
        body.enhancedPhraseDetection,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to enrich word "${body.word}":`, error.message);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to enrich word',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('translate')
  async translateSentence(@Body() body: TranslateDto) {
    try {
      this.logger.log(`Translating sentence: ${body.sentence.substring(0, 50)}...`);
      const result = await this.aiService.getTranslation(
        body.sentence,
        body.targetSentence,
        body.sentenceAnalysisMode || 'off',
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to translate sentence:`, error.message);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to translate sentence',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('enrich-stream')
  async enrichWordStream(@Body() body: EnrichDto, @Res() res: Response, @Req() req: Request) {
    try {
      this.logger.log(
        `Starting stream for word "${body.word}" with context: ${body.context.substring(0, 50)}...`,
      );

      // 设置 SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲

      const streamObservable = await this.aiService.getEnrichedDefinitionStream(
        body.word,
        body.context,
        body.enhancedPhraseDetection,
      );

      streamObservable.subscribe({
        next: (response) => {
          const stream = response.data;

          stream.on('data', (chunk: Buffer) => {
            const lines = chunk
              .toString()
              .split('\n')
              .filter((line) => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim();

                // 忽略 [DONE] 标记
                if (data === '[DONE]') {
                  res.write('data: [DONE]\n\n');
                  res.end();
                  return;
                }

                try {
                  // 转发数据到客户端
                  res.write(`data: ${data}\n\n`);
                } catch (err) {
                  this.logger.error('Error parsing chunk:', err);
                }
              }
            }
          });

          stream.on('end', () => {
            this.logger.debug('Stream ended');
            res.end();
          });

          stream.on('error', (error: Error) => {
            this.logger.error('Stream error:', error);
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
          });
        },
        error: (error) => {
          this.logger.error('Observable error:', error);
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        },
      });

      // 处理客户端断开连接
      req.on('close', () => {
        this.logger.debug('Client disconnected');
        res.end();
      });
    } catch (error) {
      this.logger.error(`Failed to start enrich stream:`, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }

  @Post('translate-stream')
  async translateSentenceStream(
    @Body() body: TranslateDto,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    try {
      this.logger.log(`Starting translation stream: ${body.sentence.substring(0, 50)}...`);

      // 设置 SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const streamObservable = await this.aiService.getTranslationStream(
        body.sentence,
        body.targetSentence,
        body.sentenceAnalysisMode || 'off',
      );

      streamObservable.subscribe({
        next: (response) => {
          const stream = response.data;

          stream.on('data', (chunk: Buffer) => {
            const lines = chunk
              .toString()
              .split('\n')
              .filter((line) => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim();

                if (data === '[DONE]') {
                  res.write('data: [DONE]\n\n');
                  res.end();
                  return;
                }

                try {
                  res.write(`data: ${data}\n\n`);
                } catch (err) {
                  this.logger.error('Error parsing chunk:', err);
                }
              }
            }
          });

          stream.on('end', () => {
            this.logger.debug('Translation stream ended');
            res.end();
          });

          stream.on('error', (error: Error) => {
            this.logger.error('Translation stream error:', error);
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
          });
        },
        error: (error) => {
          this.logger.error('Translation observable error:', error);
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        },
      });

      req.on('close', () => {
        this.logger.debug('Translation client disconnected');
        res.end();
      });
    } catch (error) {
      this.logger.error(`Failed to start translation stream:`, error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
}
