import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJobResponseDto {
  @ApiProperty({ description: 'Уникальный идентификатор задания' })
  jobId: string;
}

export class UrlResultDto {
  @ApiProperty({ description: 'Проверяемый URL' })
  url: string;

  @ApiProperty({ enum: ['pending', 'in_progress', 'success', 'error', 'cancelled'] })
  status: string;

  @ApiPropertyOptional({ description: 'HTTP-статус, возвращённый URL' })
  httpStatus?: number;

  @ApiPropertyOptional({ description: 'Сообщение об ошибке, если проверка не удалась' })
  error?: string;

  @ApiPropertyOptional({ description: 'ISO-метка времени начала обработки' })
  startedAt?: string;

  @ApiPropertyOptional({ description: 'ISO-метка времени завершения обработки' })
  finishedAt?: string;

  @ApiPropertyOptional({ description: 'Длительность в миллисекундах' })
  duration?: number;
}

export class JobDetailResponseDto {
  @ApiProperty({ description: 'Уникальный идентификатор задания' })
  id: string;

  @ApiProperty({ description: 'ISO-метка времени создания задания' })
  createdAt: string;

  @ApiProperty({ enum: ['pending', 'in_progress', 'completed', 'cancelled', 'failed'] })
  status: string;

  @ApiProperty({ type: [UrlResultDto] })
  urls: UrlResultDto[];
}

export class JobListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty({ enum: ['pending', 'in_progress', 'completed', 'cancelled', 'failed'] })
  status: string;

  @ApiProperty()
  totalUrls: number;

  @ApiProperty()
  successCount: number;

  @ApiProperty()
  errorCount: number;
}

export class JobListResponseDto {
  @ApiProperty({ type: [JobListItemDto] })
  items: JobListItemDto[];
}
