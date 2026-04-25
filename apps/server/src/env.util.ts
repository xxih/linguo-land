import { ConfigService } from '@nestjs/config';

export function requireConfig(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}
