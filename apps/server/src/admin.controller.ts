import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/guards';
import { PrismaService } from './prisma.service';

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  // 获取所有词族（用于管理员）
  @Get('families')
  async getAllFamilies() {
    const families = await this.prisma.wordFamily.findMany({
      include: {
        words: {
          select: {
            text: true,
          },
          orderBy: {
            text: 'asc',
          },
        },
      },
      orderBy: {
        rootWord: 'asc',
      },
    });

    return families;
  }

  // 获取词族统计信息
  @Get('stats')
  async getStats() {
    const totalFamilies = await this.prisma.wordFamily.count();
    const totalWords = await this.prisma.word.count();
    const totalUsers = await this.prisma.user.count();

    return {
      totalFamilies,
      totalWords,
      totalUsers,
      averageWordsPerFamily: totalFamilies > 0 ? totalWords / totalFamilies : 0,
    };
  }
}

