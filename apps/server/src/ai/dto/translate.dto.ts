import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class TranslateDto {
  @IsString()
  @IsNotEmpty()
  sentence: string;

  @IsString()
  @IsOptional()
  targetSentence?: string;

  @IsString()
  @IsOptional()
  @IsIn(['always', 'smart', 'off'])
  sentenceAnalysisMode?: 'always' | 'smart' | 'off';
}
