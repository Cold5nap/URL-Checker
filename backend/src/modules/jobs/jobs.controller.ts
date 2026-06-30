import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import {
  CreateJobResponseDto,
  JobDetailResponseDto,
  JobListResponseDto,
  JobListItemDto,
  UrlResultDto,
} from './dto/job-response.dto';
import { JobStatus } from '../../common/enums/status.enum';

/**
 * REST-контроллер для управления заданиями проверки URL.
 *
 * POST   /api/jobs       — создать задание
 * GET    /api/jobs       — список всех заданий
 * GET    /api/jobs/:id   — детальная информация
 * DELETE /api/jobs/:id   — отменить задание
 */
@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать задание проверки URL' })
  @ApiResponse({
    status: 201,
    description: 'Задание успешно создано',
    type: CreateJobResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Некорректный ввод' })
  create(@Body() dto: CreateJobDto): CreateJobResponseDto {
    const jobId = this.jobsService.create(dto.urls);
    return { jobId };
  }

  @Get()
  @ApiOperation({ summary: 'Получить список всех заданий' })
  @ApiResponse({
    status: 200,
    description: 'Список заданий',
    type: JobListResponseDto,
  })
  findAll(): JobListResponseDto {
    const items = this.jobsService.findAll().map((job) => {
      const dto = new JobListItemDto();
      dto.id = job.id;
      dto.createdAt = job.createdAt;
      dto.status = job.status;
      dto.totalUrls = job.totalUrls;
      dto.successCount = job.successCount;
      dto.errorCount = job.errorCount;
      return dto;
    });

    return { items };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить детальную информацию о задании' })
  @ApiParam({ name: 'id', description: 'UUID задания', type: String })
  @ApiResponse({
    status: 200,
    description: 'Детали задания',
    type: JobDetailResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Задание не найдено' })
  findOne(@Param('id', ParseUUIDPipe) id: string): JobDetailResponseDto {
    const job = this.jobsService.findOne(id);
    if (!job) {
      throw new NotFoundException(`Задание с id "${id}" не найдено`);
    }

    const dto = new JobDetailResponseDto();
    dto.id = job.id;
    dto.createdAt = job.createdAt;
    dto.status = job.status;
    dto.urls = job.urls.map((urlResult) => {
      const urlDto = new UrlResultDto();
      urlDto.url = urlResult.url;
      urlDto.status = urlResult.status;
      urlDto.httpStatus = urlResult.httpStatus;
      urlDto.error = urlResult.error;
      urlDto.startedAt = urlResult.startedAt;
      urlDto.finishedAt = urlResult.finishedAt;
      urlDto.duration = urlResult.duration;
      return urlDto;
    });

    return dto;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отменить ожидающее или выполняющееся задание' })
  @ApiParam({ name: 'id', description: 'UUID задания', type: String })
  @ApiResponse({ status: 204, description: 'Задание успешно отменено' })
  @ApiResponse({ status: 404, description: 'Задание не найдено' })
  @ApiResponse({ status: 409, description: 'Задание нельзя отменить (уже завершено)' })
  remove(@Param('id', ParseUUIDPipe) id: string): void {
    const job = this.jobsService.findOne(id);
    if (!job) {
      throw new NotFoundException(`Задание с id "${id}" не найдено`);
    }

    // Нельзя отменить уже завершённое задание
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.CANCELLED || job.status === JobStatus.FAILED) {
      throw new ConflictException(`Задание "${id}" уже имеет статус ${job.status} и не может быть отменено`);
    }

    this.jobsService.cancel(id);
  }
}
