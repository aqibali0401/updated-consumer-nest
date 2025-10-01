import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventHubConsumerClient, EventData, PartitionContext } from '@azure/event-hubs';
import { RabbitService } from '../rabbit/rabbit.service';
import { Inject } from '@nestjs/common';
import { LOGGER_TOKEN } from '../logger/logger.provider';

@Injectable()
export class EventHubService implements OnModuleInit {
  private consumerClient: EventHubConsumerClient | null = null;
  private messageCounters = {
    totalReceived: 0,
    rabbitPublished: 0,
    errors: 0
  };

  constructor(
    private readonly rabbit: RabbitService,
    @Inject(LOGGER_TOKEN) private readonly logger: any
  ) {}

  private getEventHubConsumerClient(): EventHubConsumerClient {
    const connectionString = process.env.EVENTHUB_CONNECTION_STRING || '';
    const eventHubName = process.env.EVENTHUB_NAME || '';
    const consumerGroup = process.env.EVENTHUB_CONSUMER_GROUP || '$Default';
    
    this.logger.info('Initializing Event Hub Consumer', { eventHubName, consumerGroup });
    
    if (!connectionString || !eventHubName) {
      this.logger.error('Missing Event Hub configuration');
      throw new Error('Missing Event Hub configuration');
    }
    
    return new EventHubConsumerClient(consumerGroup, connectionString, eventHubName);
  }

  private mapEventTypeToRoutingKey(eventType: string): string {
    const mapping: Record<string, string> = {
      'Microsoft.Devices.DeviceConnected': 'device.connected',
      'Microsoft.Devices.DeviceDisconnected': 'device.disconnected',
      'Microsoft.Devices.DeviceCreated': 'device.created',
      'Microsoft.Devices.DeviceDeleted': 'device.deleted',
    };
    return mapping[eventType] || 'device.other';
  }

  private async processEvent(eventData: EventData, context: PartitionContext): Promise<void> {
    this.messageCounters.totalReceived++;
    
    this.logger.info(`[${this.messageCounters.totalReceived}] Message received from Event Hub - Partition: ${context.partitionId}`);

    // Parse message body
    let messageBody: any = {};
    try {
      if (eventData.body) {
        if (typeof eventData.body === 'string') messageBody = JSON.parse(eventData.body);
        else if (Buffer.isBuffer(eventData.body)) messageBody = JSON.parse(eventData.body.toString());
        else messageBody = eventData.body as any;
      }
    } catch (error) {
      this.logger.warn('Failed to parse message body', { error: (error as Error).message });
      messageBody = { raw: eventData.body };
    }

    // Show the parsed payload
    this.logger.info(`Received payload: ${JSON.stringify(messageBody, null, 2)}`);

    // Handle Event Grid events (array format)
    if (Array.isArray(messageBody) && messageBody.length > 0) {
      this.logger.info(`Processing ${messageBody.length} Event Grid events`);
      
      for (const ev of messageBody) {
        if (ev.eventType?.startsWith?.('Microsoft.Devices.')) {
          const routingKey = this.mapEventTypeToRoutingKey(ev.eventType);
          this.logger.info(`Event Grid: ${ev.eventType} -> ${routingKey}`);
          
          try {
            this.logger.info(`Sending to RabbitMQ (${routingKey}): ${JSON.stringify(ev, null, 2)}`);
            await this.rabbit.publish(ev, { 
              exchange: process.env.RABBIT_EXCHANGE_NAME || 'iot.events', 
              routingKey, 
              durable: true, 
              ttlMs: Number(process.env.RABBIT_MESSAGE_TTL || 300000) 
            });
            
            this.messageCounters.rabbitPublished++;
            this.logger.info(`Event Grid sent to RabbitMQ successfully: ${routingKey}`);
          } catch (error) {
            this.messageCounters.errors++;
            this.logger.error(`Failed to send Event Grid: ${ev.eventType} - ${(error as Error).message}`);
          }
        }
      }
      return;
    }

    // Handle single Event Grid event
    if (messageBody.eventType?.startsWith?.('Microsoft.Devices.')) {
      const routingKey = this.mapEventTypeToRoutingKey(messageBody.eventType);
      this.logger.info(`Event Grid: ${messageBody.eventType} -> ${routingKey}`);
      
      try {
        this.logger.info(`Sending to RabbitMQ (${routingKey}): ${JSON.stringify(messageBody, null, 2)}`);
        await this.rabbit.publish(messageBody, { 
          exchange: process.env.RABBIT_EXCHANGE_NAME || 'iot.events', 
          routingKey, 
          durable: true, 
          ttlMs: Number(process.env.RABBIT_MESSAGE_TTL || 300000) 
        });
        
        this.messageCounters.rabbitPublished++;
        this.logger.info(`Event Grid sent to RabbitMQ successfully: ${routingKey}`);
      } catch (error) {
        this.messageCounters.errors++;
        this.logger.error(`Failed to send Event Grid: ${messageBody.eventType} - ${(error as Error).message}`);
      }
      return;
    }

    // Handle device telemetry
    const deviceId = (messageBody.deviceId as string) || (eventData.properties?.deviceId as string) || 'unknown';
    if (deviceId !== 'unknown') {
      this.logger.info(`Processing device telemetry from: ${deviceId}`);
      
      try {
        const telemetryPayload = {
          deviceId,
          timestamp: new Date().toISOString(),
          partitionId: context.partitionId,
          sequenceNumber: (eventData as any).sequenceNumber,
          offset: (eventData as any).offset,
          data: messageBody,
          properties: eventData.properties,
          systemProperties: (eventData as any).systemProperties
        };
        
        this.logger.info(`Sending to RabbitMQ (device.telemetry): ${JSON.stringify(telemetryPayload, null, 2)}`);
        await this.rabbit.publish(telemetryPayload, { 
          exchange: process.env.RABBIT_EXCHANGE_NAME || 'iot.events', 
          routingKey: 'device.telemetry', 
          durable: true, 
          ttlMs: Number(process.env.RABBIT_MESSAGE_TTL || 300000) 
        });
        
        this.messageCounters.rabbitPublished++;
        this.logger.info(`Device telemetry sent to RabbitMQ successfully: ${deviceId}`);
      } catch (error) {
        this.messageCounters.errors++;
        this.logger.error(`Failed to send device telemetry: ${deviceId} - ${(error as Error).message}`);
      }
    } else {
      this.logger.warn('Unknown device ID, skipping telemetry processing');
    }
  }

  async onModuleInit() {
    this.logger.info('Starting Event Hub Service...');
    
    // Initialize RabbitMQ
    try {
      await this.rabbit.ensureTopology();
      this.logger.info('RabbitMQ topology initialized');
    } catch (error) {
      this.logger.error('Failed to initialize RabbitMQ topology', { error: (error as Error).message });
    }
    
    // Start Event Hub consumer
    try {
      this.consumerClient = this.getEventHubConsumerClient();
      
      const subscription = this.consumerClient.subscribe({
        processEvents: async (events, context) => {
          if (events.length === 0) return;
          
          this.logger.info(`Processing ${events.length} events from partition ${context.partitionId}`);
          
          for (const event of events) {
            await this.processEvent(event, context);
          }
          
          // Log stats every 10 messages
          if (this.messageCounters.totalReceived % 10 === 0) {
            this.logger.info(`Stats: ${this.messageCounters.totalReceived} received, ${this.messageCounters.rabbitPublished} sent to RabbitMQ, ${this.messageCounters.errors} errors`);
          }
        },
        processError: async (err, context) => {
          this.messageCounters.errors++;
          this.logger.error('Error processing events', { 
            partitionId: context.partitionId, 
            error: err.message 
          });
        },
      }, { 
        startPosition: { enqueuedOn: new Date() }, 
        maxBatchSize: 10, 
        maxWaitTimeInSeconds: 30 
      });

      this.logger.info('Event Hub consumer started successfully');

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        this.logger.info(`Received ${signal}, shutting down...`);
        await subscription.close();
        await this.consumerClient?.close();
        this.logger.info('Shutdown complete');
        process.exit(0);
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      
    } catch (error) {
      this.logger.error('Failed to start Event Hub consumer', { error: (error as Error).message });
      throw error;
    }
  }
}


