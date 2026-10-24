import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationModule } from '../../modules/notification/notification.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DlqController } from './controllers/dlq.controller';
import { MetricsController } from './controllers/metrics.controller';
import { DlqProcessor } from './processors/dlq.processor';
import { NotificationProcessor } from './processors/notification.processor';
import { DLQ_QUEUE, NOTIFICATIONS_QUEUE } from './queue.constants';
import { QueueService } from './queue.service';

/** Registers the main `notifications` queue and the `notifications-dlq` dead-letter queue. */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }, { name: DLQ_QUEUE }),
    PrismaModule,
    MetricsModule,
    forwardRef(() => NotificationModule),
  ],
  controllers: [DlqController, MetricsController],
  providers: [QueueService, NotificationProcessor, DlqProcessor],
  exports: [QueueService],
})
export class QueueModule {}
