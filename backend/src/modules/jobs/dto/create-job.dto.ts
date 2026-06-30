import { IsArray, IsString, IsUrl, ArrayNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateJobDto {
  @ApiProperty({
    description: 'Список URL для проверки',
    example: ['https://example.com', 'https://google.com'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  urls: string[];
}
