import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VocabularyController } from './vocabulary.controller';
import { VocabularyService } from './vocabulary.service';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { AdminController } from './admin.controller';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    AiModule,
  ],
  controllers: [AppController, VocabularyController, DictionaryController, AdminController],
  providers: [AppService, VocabularyService, DictionaryService, PrismaService],
})
export class AppModule {}
