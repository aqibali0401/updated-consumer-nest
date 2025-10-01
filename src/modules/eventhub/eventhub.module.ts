import { Module } from '@nestjs/common';
import { EventHubService } from './eventhub.service';
import { RabbitModule } from '../rabbit/rabbit.module';
import { TransformerModule } from '../transformer/transformer.module';

@Module({
  imports: [RabbitModule, TransformerModule],
  providers: [EventHubService],
})
export class EventHubModule {}


