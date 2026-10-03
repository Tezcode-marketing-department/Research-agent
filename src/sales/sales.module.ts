import { Module } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { SalesListenerService } from './sales-listener.service';

@Module({
  providers: [PrismaService, SalesListenerService],
})
export class SalesModule {}
