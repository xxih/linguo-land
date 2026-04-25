import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VocabularyController } from './vocabulary.controller';
import { VocabularyService } from './vocabulary.service';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { DictionaryWhitelistController } from './dictionary-whitelist.controller';
import { DictionaryWhitelistService } from './dictionary-whitelist.service';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { DocumentsModule } from './documents/documents.module';
import { ReadingProgressModule } from './reading-progress/reading-progress.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    AiModule,
    DocumentsModule,
    ReadingProgressModule,
  ],
  controllers: [
    AppController,
    VocabularyController,
    DictionaryController,
    DictionaryWhitelistController,
  ],
  providers: [
    AppService,
    VocabularyService,
    DictionaryService,
    DictionaryWhitelistService,
    PrismaService,
  ],
})
export class AppModule {}
