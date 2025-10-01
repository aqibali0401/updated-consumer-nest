import { Controller, Get, Post, Body } from '@nestjs/common';
import { RabbitService } from '../modules/rabbit/rabbit.service';
import { Inject } from '@nestjs/common';
import { LOGGER_TOKEN } from '../modules/logger/logger.provider';

@Controller('/')
export class HealthController {
  constructor(
    private readonly rabbitService: RabbitService,
    @Inject(LOGGER_TOKEN) private readonly logger: any
  ) {}

  @Get()
  status() {
    return {
      status: 200,
      isSuccess: true,
      message: 'IoT Consumer NestJS Application is running',
      data: {
        service: 'updated-iot-consumer-nest',
        version: '1.0.0',
        description: 'Event Hub to RabbitMQ message processor'
      },
    };
  }

  @Post('test-rabbit')
  async testRabbit(@Body() testData: any) {
    try {
      this.logger.info('Testing RabbitMQ connection with test data', { testData });
      
      // Determine routing key based on message type
      let routingKey = 'device.telemetry';
      if (testData.eventType?.startsWith?.('Microsoft.Devices.')) {
        const mapping: Record<string, string> = {
          'Microsoft.Devices.DeviceConnected': 'device.connected',
          'Microsoft.Devices.DeviceDisconnected': 'device.disconnected',
          'Microsoft.Devices.DeviceCreated': 'device.created',
          'Microsoft.Devices.DeviceDeleted': 'device.deleted',
        };
        routingKey = mapping[testData.eventType] || 'device.other';
      } else if (testData.deviceId) {
        routingKey = 'device.telemetry';
      }

      this.logger.info(`Test message routing: ${routingKey}`);

      const result = await this.rabbitService.publish(testData, {
        exchange: process.env.RABBIT_EXCHANGE_NAME || 'iot.events',
        routingKey: routingKey,
        durable: true,
        ttlMs: Number(process.env.RABBIT_MESSAGE_TTL || 300000),
      });

      this.logger.info('Test message sent to RabbitMQ successfully', result);
      
      return {
        status: 200,
        isSuccess: true,
        message: 'Test message sent to RabbitMQ successfully',
        data: result,
      };
    } catch (error) {
      this.logger.error('Failed to send test message to RabbitMQ', { error: (error as Error).message });
      return {
        status: 500,
        isSuccess: false,
        message: 'Failed to send test message to RabbitMQ',
        error: (error as Error).message,
      };
    }
  }
}


