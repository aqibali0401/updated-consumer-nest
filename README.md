# IoT Consumer NestJS Application

A NestJS application that consumes IoT messages from Azure Event Hub and forwards them to RabbitMQ with comprehensive logging.

## Architecture Flow

```
IoT Devices → Azure IoT Hub → Event Hub → NestJS App → RabbitMQ
```

### 1. **Data Source**: IoT Devices
- IoT devices send telemetry data to Azure IoT Hub
- Azure IoT Hub routes messages to Event Hub
- Event Hub acts as a message broker for real-time data streaming

### 2. **Data Processing**: Event Hub Consumer
- The NestJS application consumes messages from Event Hub
- Processes different types of messages:
  - **Device Telemetry**: Regular sensor data from devices
  - **Device Lifecycle Events**: Device connected/disconnected/created/deleted
  - **Event Grid Events**: Azure Event Grid notifications

### 3. **Message Routing**: Smart Routing Logic
- Messages are categorized and routed to appropriate RabbitMQ queues
- Routing keys are mapped based on message type:
  - `device.telemetry` - for sensor data
  - `device.connected` - for device connection events
  - `device.disconnected` - for device disconnection events
  - `device.created` - for new device registrations
  - `device.deleted` - for device deletions

### 4. **Message Publishing**: RabbitMQ
- Processed messages are published to RabbitMQ with appropriate routing keys
- Messages are persistent and have TTL (Time To Live) configuration
- RabbitMQ acts as a reliable message broker for downstream consumers

## Environment Variables

```env
# Event Hub Configuration
EVENTHUB_CONNECTION_STRING=your_event_hub_connection_string
EVENTHUB_NAME=your_event_hub_name
EVENTHUB_CONSUMER_GROUP=$Default

# RabbitMQ Configuration
RABBIT_PROTOCOL=amqp
RABBIT_HOSTNAME=localhost
RABBIT_PORT=5672
RABBIT_USERNAME=guest
RABBIT_PASSWORD=guest
RABBIT_EXCHANGE_NAME=iot.events
RABBIT_QUEUE_NAME=reflect.service
RABBIT_BINDING_KEYS=device.*,device.telemetry
RABBIT_MESSAGE_TTL=300000

# Logging
LOG_LEVEL=info
LOG_RETAIN_PERIOD=1d
```

## Running the Application

```bash
# Install dependencies
npm install

# Development mode
npm run start:dev

# Production build
npm run build
npm start
```

## API Endpoints

- `GET /` - Health check endpoint
- `POST /test-rabbit` - Test RabbitMQ connection with custom data

## Logging

The application provides comprehensive logging throughout the data flow:

- **Event Hub Connection**: Connection status and configuration
- **Message Processing**: Each message received and processed
- **RabbitMQ Publishing**: Success/failure of message publishing
- **Error Handling**: Detailed error information
- **Statistics**: Periodic stats every 10 messages

Logs are written to:
- Console (with colors)
- `logs/combined-logs/combined-YYYY-MM-DD.log`
- `logs/error-logs/error-YYYY-MM-DD.log`

## Testing the Flow

1. **Start the application**:
   ```bash
   npm run start:dev
   ```

2. **Test RabbitMQ connection**:
   ```bash
   curl -X POST http://localhost:5001/test-rabbit \
     -H "Content-Type: application/json" \
     -d '{"test": "message", "deviceId": "test-device"}'
   ```

3. **Monitor logs** to see the complete flow:
   - Event Hub connection
   - Message processing
   - RabbitMQ publishing
   - Statistics

## Message Flow Example

When an IoT device sends telemetry data:

1. **Event Hub receives message** → Logs: "Message received from Event Hub"
2. **Parse message body** → Logs: "Processing device telemetry"
3. **Publish to RabbitMQ** → Logs: "Publishing message to RabbitMQ"
4. **Success confirmation** → Logs: "Device telemetry sent to RabbitMQ"

The application provides clear visibility into every step of the data processing pipeline.