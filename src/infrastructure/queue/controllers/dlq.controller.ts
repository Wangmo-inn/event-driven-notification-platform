import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseType } from 'src/shared/types/response-type';
import { QueueService } from '../queue.service';

/** Ops endpoints: queue depth, job status, list dead-lettered notifications, replay one. */
@ApiTags('Queue / DLQ')
@Controller('queue')
export class DlqController {
  constructor(private readonly queueService: QueueService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Live job counts for the main queue and the DLQ' })
  async getStats(): Promise<ResponseType<Record<string, unknown>>> {
    return { success: true, message: 'Queue stats retrieved', data: await this.queueService.getQueueStats() };
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Status of a single job (waiting/active/completed/failed/delayed)' })
  async getJob(@Param('jobId') jobId: string): Promise<ResponseType<Record<string, unknown>>> {
    return { success: true, message: 'Job status retrieved', data: await this.queueService.getJobStatus(jobId) };
  }

  @Get('dlq')
  @ApiOperation({ summary: 'List notifications that exhausted every retry attempt' })
  async listDeadLettered(): Promise<ResponseType<Record<string, unknown>[]>> {
    return { success: true, message: 'Dead-lettered notifications retrieved', data: await this.queueService.listDeadLettered() };
  }

  @Post('dlq/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Replay a dead-lettered notification onto the main queue' })
  async retry(@Body() body: { idempotencyKey: string }): Promise<ResponseType<{ jobId: string }>> {
    const result = await this.queueService.retryDeadLettered(body.idempotencyKey);
    return { success: true, message: 'Notification re-queued', data: { jobId: result.jobId } };
  }
}
