import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [HttpModule],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService], // 导出 AiService 以便在其他模块中使用
})
export class AiModule {}
