import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from '../rest/health.controller';
import { RabbitModule } from './rabbit/rabbit.module';
import { EventHubModule } from './eventhub/eventhub.module';
import { AzureModule } from './azure/azure.module';
import { LoggerModule } from './logger/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventHubModule,    // Handles Event Hub consumption
    RabbitModule,      // Handles RabbitMQ publishing
    LoggerModule,      // Provides logging services
    AzureModule,       // Provides Azure IoT Hub endpoints
  ],
  controllers: [HealthController],
})
export class AppModule {}


