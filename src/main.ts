import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';
import { Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  const port = process.env.PORT || 5001;
  
  Logger.log('🚀 Starting IoT Consumer NestJS Application...');
  Logger.log(`📡 Server listening on port ${port}`);
  Logger.log('📋 Environment Configuration:');
  Logger.log(`   - Event Hub: ${process.env.EVENTHUB_NAME || 'Not configured'}`);
  Logger.log(`   - RabbitMQ: ${process.env.RABBIT_HOSTNAME || 'localhost'}:${process.env.RABBIT_PORT || '5672'}`);
  Logger.log(`   - Exchange: ${process.env.RABBIT_EXCHANGE_NAME || 'iot.events'}`);
  
  await app.listen(port as number);
  Logger.log('✅ Application started successfully!');
  Logger.log('📨 Listening for IoT messages from Event Hub...');
}

bootstrap();


