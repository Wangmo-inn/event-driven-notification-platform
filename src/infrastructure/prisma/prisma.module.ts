import { Module } from '@nestjs/common';
import { NotificationRepository } from './notification.repository';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService, NotificationRepository],
  exports: [PrismaService, NotificationRepository],
})
export class PrismaModule {}
