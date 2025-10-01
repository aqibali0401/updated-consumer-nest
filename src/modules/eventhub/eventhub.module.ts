import { Module } from '@nestjs/common';
import { EventHubService } from './eventhub.service';
import { RabbitModule } from '../rabbit/rabbit.module';

@Module({
  imports: [RabbitModule],
  providers: [EventHubService],
})
export class EventHubModule {}


