import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsGateway } from './jobs.gateway';

@Module({
  controllers: [JobsController],
  providers: [JobsService, JobsGateway],
})
export class JobsModule {}
