import { Controller, Get, Header } from '@nestjs/common';
import { DictionaryWhitelistService } from './dictionary-whitelist.service';
import type { DictionaryWhitelistSnapshot } from './dictionary-whitelist.service';

/**
 * 词典白名单接口（公开，不需要登录）。
 *
 * 单独一个 Controller / 单独的 path，避开 DictionaryController('api/v1/dictionary')
 * 的 :word 通配路由。也避免 JwtAuthGuard 的影响。
 */
@Controller('api/v1/dictionary-whitelist')
export class DictionaryWhitelistController {
  constructor(private readonly service: DictionaryWhitelistService) {}

  // 客户端会把响应缓存到 chrome.storage.local，通过 version 字段判断更新；
  // 这里再加 Cache-Control 让 service worker 自身的 HTTP 缓存也能命中
  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  get(): DictionaryWhitelistSnapshot {
    return this.service.getSnapshot();
  }
}
