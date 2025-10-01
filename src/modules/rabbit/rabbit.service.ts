import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import * as amqplib from 'amqplib';
import { LOGGER_TOKEN } from '../logger/logger.provider';

@Injectable()
export class RabbitService implements OnModuleDestroy {
  private connection: any = null;
  private channel: amqplib.Channel | null = null;

  constructor(@Inject(LOGGER_TOKEN) private readonly logger: any) {}

  private getRabbitUrl(): string {
    const protocol = process.env.RABBIT_PROTOCOL || 'amqp';
    const hostname = process.env.RABBIT_HOSTNAME || 'localhost';
    const port = process.env.RABBIT_PORT || '5672';
    const username = process.env.RABBIT_USERNAME || 'guest';
    const password = process.env.RABBIT_PASSWORD || 'guest';
    return `${protocol}://${username}:${password}@${hostname}:${port}`;
  }

  async getChannel(): Promise<amqplib.Channel> {
    if (this.channel) return this.channel;
    const url = this.getRabbitUrl();
    
    this.logger.info('🔌 Connecting to RabbitMQ...', {
      host: process.env.RABBIT_HOSTNAME || 'localhost',
      port: process.env.RABBIT_PORT || '5672',
      protocol: process.env.RABBIT_PROTOCOL || 'amqp',
      username: process.env.RABBIT_USERNAME || 'guest'
    });
    
    try {
      this.connection = await amqplib.connect(url, {
        heartbeat: Number(process.env.RABBIT_HEARTBEAT || 10),
      });
      this.channel = await this.connection.createChannel();
      const prefetch = Number(process.env.RABBIT_PREFETCH_COUNT || 10);
      await this.channel!.prefetch(prefetch);
      
      this.logger.info('✅ Connected to RabbitMQ successfully', {
        host: process.env.RABBIT_HOSTNAME || 'localhost',
        port: process.env.RABBIT_PORT || '5672',
        prefetchCount: prefetch,
        heartbeat: `${process.env.RABBIT_HEARTBEAT || 10}s`
      });
      return this.channel!;
    } catch (error) {
      this.logger.error('❌ Failed to connect to RabbitMQ', { 
        host: process.env.RABBIT_HOSTNAME || 'localhost',
        port: process.env.RABBIT_PORT || '5672',
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw new Error(`RabbitMQ connection failed: ${(error as Error).message}`);
    }
  }

  async ensureTopology(): Promise<void> {
    this.logger.info('🏗️ Setting up RabbitMQ topology...');
    
    const ch = await this.getChannel();
    const exchangeName = process.env.RABBIT_EXCHANGE_NAME || 'iot.events';
    const exchangeType = process.env.RABBIT_EXCHANGE_TYPE || 'topic';
    const queueName = process.env.RABBIT_QUEUE_NAME || 'reflect.service';
    const bindingKeysEnv = process.env.RABBIT_BINDING_KEYS || 'device.*,device.telemetry,test.*';
    const bindingKeys = bindingKeysEnv.split(',').map((k) => k.trim()).filter(Boolean);
    
    try {
      await ch.assertExchange(exchangeName, exchangeType, { durable: true });
      this.logger.info('🔀 Exchange created/verified', { 
        exchangeName: `📢 ${exchangeName}`,
        type: `🔧 ${exchangeType}`,
        durable: '✅'
      });
      
      await ch.assertQueue(queueName, { durable: true });
      this.logger.info('📦 Queue created/verified', { 
        queueName: `📋 ${queueName}`,
        durable: '✅'
      });
      
      for (const key of bindingKeys) {
        await ch.bindQueue(queueName, exchangeName, key);
        this.logger.info('🔗 Binding created', {
          queue: `📋 ${queueName}`,
          exchange: `📢 ${exchangeName}`,
          routingKey: `🎯 ${key}`
        });
      }
      
      this.logger.info('✅ RabbitMQ topology setup complete', { 
        exchange: `📢 ${exchangeName} (${exchangeType})`,
        queue: `📋 ${queueName}`,
        bindings: `🔗 ${bindingKeys.length} routing keys`,
        routingKeys: bindingKeys.map(k => `🎯 ${k}`).join(', ')
      });
    } catch (error) {
      this.logger.error('💥 Failed to setup RabbitMQ topology', { 
        exchange: exchangeName,
        queue: queueName,
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  async publish(payload: unknown, opts: { exchange: string; routingKey?: string; durable?: boolean; ttlMs?: number }): Promise<{ published: boolean; exchange: string; routingKey: string; size: number }> {
    const ch = await this.getChannel();
    const { exchange, routingKey = '', durable = true, ttlMs } = opts;
    const buffer = Buffer.from(JSON.stringify(payload));
    
    try {
      await ch.assertExchange(exchange, 'topic', { durable });
      
      // Create a beautiful preview of the payload for logging
      const payloadPreview = this.createPayloadPreview(payload);
      const messageId = this.generateMessageId();
      
      this.logger.info('📤 Publishing message to RabbitMQ', {
        messageId,
        exchange: `🔀 ${exchange}`,
        routingKey: `🎯 ${routingKey}`,
        size: `${buffer.length} bytes`,
        durable: durable ? '✅' : '❌',
        ttl: ttlMs ? `${ttlMs}ms` : '∞',
        payloadPreview,
        timestamp: new Date().toISOString()
      });
      
      const published = ch.publish(exchange, routingKey, buffer, {
        persistent: true,
        ...(ttlMs ? { expiration: String(ttlMs) } : {}),
        contentType: 'application/json',
        messageId,
        timestamp: Date.now(),
      });
      
      if (!published) {
        this.logger.error('❌ Failed to publish message to RabbitMQ - channel buffer full', {
          messageId,
          exchange,
          routingKey,
          size: buffer.length
        });
        throw new Error('Failed to publish message to RabbitMQ');
      }
      
      this.logger.info('✅ Message published to RabbitMQ successfully', {
        messageId,
        exchange: `🔀 ${exchange}`,
        routingKey: `🎯 ${routingKey}`,
        size: `${buffer.length} bytes`,
        published: '✅'
      });
      
      return { published, exchange, routingKey, size: buffer.length };
    } catch (error) {
      this.logger.error('💥 Error publishing message to RabbitMQ', { 
        exchange: `🔀 ${exchange}`, 
        routingKey: `🎯 ${routingKey}`,
        size: buffer.length,
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  private createPayloadPreview(payload: unknown): string {
    try {
      const jsonString = JSON.stringify(payload);
      const maxLength = 200;
      
      if (jsonString.length <= maxLength) {
        return `📄 ${jsonString}`;
      }
      
      const truncated = jsonString.substring(0, maxLength);
      const preview = `${truncated}...`;
      return `📄 ${preview} (truncated, full size: ${jsonString.length} chars)`;
    } catch (error) {
      return `📄 [Non-serializable object: ${typeof payload}]`;
    }
  }

  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `msg_${timestamp}_${random}`;
  }

  async onModuleDestroy() {
    try { 
      if (this.channel) await this.channel.close(); 
    } catch (e) { 
      this.logger.warn?.(`Error closing channel: ${String(e)}`); 
    }
    try { 
      if (this.connection) await this.connection.close(); 
    } catch (e) { 
      this.logger.warn?.(`Error closing connection: ${String(e)}`); 
    }
    this.channel = null; 
    this.connection = null;
  }
}


