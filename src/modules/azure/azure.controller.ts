import { Controller, Get, Query, Res, Post, Body } from '@nestjs/common';
import { Response } from 'express';
import { AzureService } from './azure.service';
import { RabbitService } from '../rabbit/rabbit.service';

@Controller()
export class AzureController {
  constructor(private readonly azure: AzureService, private readonly rabbit: RabbitService) {}

  @Get('new-event')
  async sendC2D(@Query('deviceId') deviceId: string, @Query('payload') payload: string, @Res() res: Response) {
    if (!deviceId) return res.status(400).json({ statusCode: 400, message: 'Please provide a valid device id to continue' });
    if (!payload) return res.status(400).json({ statusCode: 400, message: 'Please provide a message' });
    await this.azure.sendC2D(deviceId, JSON.stringify(payload));
    return res.status(200).json({ statusCode: 200, message: 'Message delivered to device' });
  }

  @Get('new-method')
  async newMethod(@Query('deviceId') deviceId: string, @Query('methodName') methodName: string, @Query('payload') payload: string | undefined, @Res() res: Response) {
    if (!deviceId) return res.status(400).json({ statusCode: 400, message: 'Please provide a valid device id to continue' });
    if (!methodName) return res.status(400).json({ statusCode: 400, message: 'Please provide a valid method name' });
    const parsed = payload ? JSON.parse(payload) : undefined;
    const status = await this.azure.invokeMethod(deviceId, methodName, parsed);
    if (status?.result?.status !== 200) return res.status(status?.result?.status).json({ statusCode: status?.result?.status, message: status?.result?.payload });
    return res.status(200).json({ statusCode: 200, message: 'Message delivered to device' });
  }

  @Post('rabbit-test-telemetry')
  async rabbitTestTelemetry() {
    const testTelemetry = { deviceId: 'test-device-123', timestamp: new Date().toISOString(), temperature: 25.5, humidity: 60.2, location: { lat: 40.7128, lon: -74.0060 } };
    const result = await this.rabbit.publish(testTelemetry, { exchange: process.env.RABBIT_EXCHANGE_NAME || 'iot.events', routingKey: 'device.telemetry', durable: true, ttlMs: Number(process.env.RABBIT_MESSAGE_TTL || 300000) });
    return { statusCode: 200, result, message: 'Test telemetry sent to RabbitMQ' };
  }
}


