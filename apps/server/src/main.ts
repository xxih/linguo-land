import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 启用CORS，允许Chrome扩展访问
  app.enableCors({
    origin: true, // 允许所有来源（在生产环境中应该限制）
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`[START] Server running on http://localhost:${port}`);
}
bootstrap();
