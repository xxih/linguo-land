import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class EnrichDto {
  @IsString()
  @IsNotEmpty()
  word: string;

  @IsString()
  @IsNotEmpty()
  context: string;

  @IsBoolean()
  @IsOptional()
  enhancedPhraseDetection?: boolean;
}
