import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { EventHubConsumerClient, EventData, PartitionContext } from '@azure/event-hubs';

import { RabbitService } from '../rabbit/rabbit.service';
import { TransformerService, DeviceTelemetryData } from '../transformer/transformer.service';
import { LOGGER_TOKEN } from '../logger/logger.provider';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface EventGridEvent {
  eventType: string;
  deviceId?: string;
  [key: string]: any;
}

interface MessageCounters {
  totalReceived: number;
  rabbitPublished: number;
  errors: number;
}

interface RabbitConfig {
  exchange: string;
  durable: boolean;
  ttlMs: number;
}

interface EventHubConfig {
  connectionString: string;
  eventHubName: string;
  consumerGroup: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_RABBIT_CONFIG = {
  EXCHANGE: 'iot.events',
  TTL_MS: 300000,
  DURABLE: true,
} as const;

const DEFAULT_EVENTHUB_CONFIG = {
  CONSUMER_GROUP: '$Default',
} as const;

const EVENT_TYPE_MAPPING = {
  'Microsoft.Devices.DeviceConnected': 'device.connected',
  'Microsoft.Devices.DeviceDisconnected': 'device.disconnected',
  'Microsoft.Devices.DeviceCreated': 'device.created',
  'Microsoft.Devices.DeviceDeleted': 'device.deleted',
} as const;

const ROUTING_KEYS = {
  DEVICE_TELEMETRY: 'device.telemetry',
  DEVICE_OTHER: 'device.other',
} as const;

const EVENT_TYPES = {
  NEW_DEVICE: 'new_device',
  MICROSOFT_DEVICES_PREFIX: 'Microsoft.Devices.',
} as const;

// ============================================================================
// MAIN SERVICE CLASS
// ============================================================================

/**
 * EventHubService handles Azure Event Hub message processing and routing to RabbitMQ
 * 
 * Features:
 * - Processes Event Grid events and device telemetry
 * - Transforms new device events using TransformerService
 * - Routes messages to RabbitMQ with appropriate routing keys
 * - Provides comprehensive logging and error handling
 */
@Injectable()
export class EventHubService implements OnModuleInit {
  // ========================================================================
  // PRIVATE PROPERTIES
  // ========================================================================
  
  private consumerClient: EventHubConsumerClient | null = null;
  private messageCounters: MessageCounters = {
    totalReceived: 0,
    rabbitPublished: 0,
    errors: 0
  };

  // ========================================================================
  // CONSTRUCTOR
  // ========================================================================

  constructor(
    private readonly rabbit: RabbitService,
    private readonly transformer: TransformerService,
    @Inject(LOGGER_TOKEN) private readonly logger: any
  ) {}

  // ========================================================================
  // PUBLIC METHODS
  // ========================================================================

  /**
   * Initializes the Event Hub service and starts consuming messages
   */
  async onModuleInit(): Promise<void> {
    this.logger.info('Starting Event Hub Service...');
    
    await this.initializeRabbitMQ();
    await this.startEventHubConsumer();
  }

  // ========================================================================
  // CONFIGURATION METHODS
  // ========================================================================

  /**
   * Creates Event Hub consumer client with configuration validation
   */
  private getEventHubConsumerClient(): EventHubConsumerClient {
    const config = this.getEventHubConfig();
    
    this.logger.info('Initializing Event Hub Consumer', { 
      eventHubName: config.eventHubName, 
      consumerGroup: config.consumerGroup 
    });
    
    if (!config.connectionString || !config.eventHubName) {
      this.logger.error('Missing Event Hub configuration');
      throw new Error('Missing Event Hub configuration');
    }
    
    return new EventHubConsumerClient(
      config.consumerGroup, 
      config.connectionString, 
      config.eventHubName
    );
  }

  /**
   * Gets Event Hub configuration from environment variables
   */
  private getEventHubConfig(): EventHubConfig {
    return {
      connectionString: process.env.EVENTHUB_CONNECTION_STRING || '',
      eventHubName: process.env.EVENTHUB_NAME || '',
      consumerGroup: process.env.EVENTHUB_CONSUMER_GROUP || DEFAULT_EVENTHUB_CONFIG.CONSUMER_GROUP,
    };
  }

  /**
   * Gets RabbitMQ configuration from environment variables
   */
  private getRabbitConfig(): RabbitConfig {
    return {
      exchange: process.env.RABBIT_EXCHANGE_NAME || DEFAULT_RABBIT_CONFIG.EXCHANGE,
      durable: DEFAULT_RABBIT_CONFIG.DURABLE,
      ttlMs: Number(process.env.RABBIT_MESSAGE_TTL || DEFAULT_RABBIT_CONFIG.TTL_MS)
    };
  }

  // ========================================================================
  // MESSAGE PARSING METHODS
  // ========================================================================

  /**
   * Parses EventData body into a usable object
   */
  private parseMessageBody(eventData: EventData): any {
    try {
      if (!eventData.body) return {};
      
      if (typeof eventData.body === 'string') {
        return JSON.parse(eventData.body);
      }
      
      if (Buffer.isBuffer(eventData.body)) {
        return JSON.parse(eventData.body.toString());
      }
      
      return eventData.body as any;
    } catch (error) {
      this.logger.warn('Failed to parse message body', { 
        error: (error as Error).message 
      });
      return { raw: eventData.body };
    }
  }

  /**
   * Extracts message type from parsed message body
   */
  private getMessageType(messageBody: any): string {
    if (Array.isArray(messageBody)) {
      return messageBody[0]?.eventType;
    }
    return messageBody?.eventType;
  }

  /**
   * Checks if message is an Event Grid event
   */
  private isEventGridEvent(messageBody: any): boolean {
    if (Array.isArray(messageBody)) {
      return messageBody[0]?.eventType?.startsWith?.(EVENT_TYPES.MICROSOFT_DEVICES_PREFIX) || false;
    }
    return messageBody?.eventType?.startsWith?.(EVENT_TYPES.MICROSOFT_DEVICES_PREFIX) || false;
  }

  /**
   * Extracts device ID from message body or event data properties
   */
  private extractDeviceId(messageBody: any, eventData: EventData): string {
    if (Array.isArray(messageBody)) {
      return messageBody[0]?.deviceId || 'unknown';
    }
    
    return messageBody?.deviceId || 
           (eventData.properties?.deviceId as string) || 
           'unknown';
  }

  // ========================================================================
  // ROUTING METHODS
  // ========================================================================

  /**
   * Maps Event Grid event types to RabbitMQ routing keys
   */
  private mapEventTypeToRoutingKey(eventType: string): string {
    return EVENT_TYPE_MAPPING[eventType as keyof typeof EVENT_TYPE_MAPPING] || ROUTING_KEYS.DEVICE_OTHER;
  }

  /**
   * Publishes data to RabbitMQ with error handling and counter updates
   */
  private async publishToRabbit(data: any, routingKey: string): Promise<void> {
    const config = this.getRabbitConfig();
    
    try {
      await this.rabbit.publish(data, {
        ...config,
        routingKey
      });
      
      this.messageCounters.rabbitPublished++;
      this.logger.info(`Message sent to RabbitMQ: ${routingKey}`);
    } catch (error) {
      this.messageCounters.errors++;
      this.logger.error(`Failed to send message: ${routingKey} - ${(error as Error).message}`);
      throw error;
    }
  }

  // ========================================================================
  // TELEMETRY METHODS
  // ========================================================================

  /**
   * Creates a standardized telemetry payload from event data
   */
  private createTelemetryPayload(
    eventData: EventData, 
    context: PartitionContext, 
    data: any, 
    deviceId: string
  ): DeviceTelemetryData {
    return {
      deviceId,
      timestamp: new Date().toISOString(),
      partitionId: context.partitionId,
      sequenceNumber: (eventData as any).sequenceNumber,
      offset: (eventData as any).offset,
      data,
      systemProperties: (eventData as any).systemProperties
    };
  }

  // ========================================================================
  // EVENT HANDLING METHODS
  // ========================================================================

  /**
   * Main event processing method - routes events to appropriate handlers
   */
  private async processEvent(eventData: EventData, context: PartitionContext): Promise<void> {
    this.messageCounters.totalReceived++;
    
    this.logger.info(`[${this.messageCounters.totalReceived}] Message received from Event Hub - Partition: ${context.partitionId}`);

    const messageBody = this.parseMessageBody(eventData);
    const messageType = this.getMessageType(messageBody);
    
    this.logger.info(`Message type:-------------------------------------- ${messageType || 'unknown'}`);

    // Route to appropriate handler based on message structure
    if (Array.isArray(messageBody) && messageBody.length > 0) {
      await this.handleEventGridArray(messageBody, eventData, context);
      return;
    }

    if (this.isEventGridEvent(messageBody)) {
      await this.handleSingleEventGridEvent(messageBody, eventData, context);
      return;
    }

    await this.handleDeviceTelemetry(messageBody, eventData, context);
  }

  /**
   * Handles array of Event Grid events
   */
  private async handleEventGridArray(
    messageBody: EventGridEvent[], 
    eventData: EventData, 
    context: PartitionContext
  ): Promise<void> {
    this.logger.info(`Processing ${messageBody.length} Event Grid events`);
    
    for (const event of messageBody) {
      if (event.eventType?.startsWith?.(EVENT_TYPES.MICROSOFT_DEVICES_PREFIX)) {
        await this.handleEventGridEvent(event, eventData, context);
      } else if (event.eventType === EVENT_TYPES.NEW_DEVICE) {
        await this.handleNewDeviceEvent(event, eventData, context);
      }
    }
  }

  /**
   * Handles single Event Grid event
   */
  private async handleEventGridEvent(
    event: EventGridEvent, 
    eventData: EventData, 
    context: PartitionContext
  ): Promise<void> {
    const routingKey = this.mapEventTypeToRoutingKey(event.eventType);
    this.logger.info(`Event Grid: ${event.eventType} -> ${routingKey}`);
    
    await this.publishToRabbit(event, routingKey);
  }

  /**
   * Handles single Event Grid event from array or single message
   */
  private async handleSingleEventGridEvent(
    messageBody: any, 
    eventData: EventData, 
    context: PartitionContext
  ): Promise<void> {
    const event = Array.isArray(messageBody) ? messageBody[0] : messageBody;
    await this.handleEventGridEvent(event, eventData, context);
  }

  /**
   * Handles new device events with transformation
   */
  private async handleNewDeviceEvent(
    event: EventGridEvent, 
    eventData: EventData, 
    context: PartitionContext
  ): Promise<void> {
    const deviceId = event.deviceId || 'unknown';
    
    if (deviceId === 'unknown') {
      this.logger.warn('New device event missing deviceId');
      return;
    }

    this.logger.info(`Processing new device event: ${deviceId}`);
    
    const telemetryPayload = this.createTelemetryPayload(eventData, context, event, deviceId);
    const transformedData = this.transformer.processDeviceTelemetry(telemetryPayload);
    
    if (transformedData) {
      await this.publishToRabbit(transformedData, ROUTING_KEYS.DEVICE_TELEMETRY);
      this.logger.info(`Transformed new device data sent: ${deviceId}`);
    }
  }

  /**
   * Handles device telemetry events
   */
  private async handleDeviceTelemetry(
    messageBody: any, 
    eventData: EventData, 
    context: PartitionContext
  ): Promise<void> {
    const deviceId = this.extractDeviceId(messageBody, eventData);
    
    if (deviceId === 'unknown') {
      this.logger.warn('Unknown device ID, skipping telemetry processing');
      return;
    }

    this.logger.info(`Processing device telemetry from: ${deviceId}`);
    
    const messageData = Array.isArray(messageBody) ? messageBody[0] : messageBody;
    const telemetryPayload = this.createTelemetryPayload(eventData, context, messageData, deviceId);
    const transformedData = this.transformer.processDeviceTelemetry(telemetryPayload);
    
    if (transformedData) {
      await this.publishToRabbit(transformedData, ROUTING_KEYS.DEVICE_TELEMETRY);
      this.logger.info(`Transformed device data sent: ${deviceId}`);
    } else {
      await this.publishToRabbit(telemetryPayload, ROUTING_KEYS.DEVICE_TELEMETRY);
      this.logger.info(`Device telemetry sent: ${deviceId}`);
    }
  }

  // ========================================================================
  // INITIALIZATION METHODS
  // ========================================================================

  /**
   * Initializes RabbitMQ topology
   */
  private async initializeRabbitMQ(): Promise<void> {
    try {
      await this.rabbit.ensureTopology();
      this.logger.info('RabbitMQ topology initialized');
    } catch (error) {
      this.logger.error('Failed to initialize RabbitMQ topology', { 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Starts Event Hub consumer with proper error handling and graceful shutdown
   */
  private async startEventHubConsumer(): Promise<void> {
    try {
      this.consumerClient = this.getEventHubConsumerClient();
      
      const subscription = this.consumerClient.subscribe({
        processEvents: this.createProcessEventsHandler(),
        processError: this.createProcessErrorHandler(),
      }, { 
        startPosition: { enqueuedOn: new Date() }, 
        maxBatchSize: 10, 
        maxWaitTimeInSeconds: 30 
      });

      this.logger.info('Event Hub consumer started successfully');
      this.setupGracefulShutdown(subscription);
      
    } catch (error) {
      this.logger.error('Failed to start Event Hub consumer', { 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Creates the process events handler for Event Hub subscription
   */
  private createProcessEventsHandler() {
    return async (events: EventData[], context: PartitionContext) => {
      if (events.length === 0) return;
      
      this.logger.info(`Processing ${events.length} events from partition ${context.partitionId}`);
      
      for (const event of events) {
        await this.processEvent(event, context);
      }
      
      this.logStatsIfNeeded();
    };
  }

  /**
   * Creates the process error handler for Event Hub subscription
   */
  private createProcessErrorHandler() {
    return async (err: Error, context: PartitionContext) => {
      this.messageCounters.errors++;
      this.logger.error('Error processing events', { 
        partitionId: context.partitionId, 
        error: err.message 
      });
    };
  }

  /**
   * Logs statistics every 10 messages
   */
  private logStatsIfNeeded(): void {
    if (this.messageCounters.totalReceived % 10 === 0) {
      this.logger.info(`Stats: ${this.messageCounters.totalReceived} received, ${this.messageCounters.rabbitPublished} sent to RabbitMQ, ${this.messageCounters.errors} errors`);
    }
  }

  /**
   * Sets up graceful shutdown handlers
   */
  private setupGracefulShutdown(subscription: any): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down...`);
      await subscription.close();
      await this.consumerClient?.close();
      this.logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}