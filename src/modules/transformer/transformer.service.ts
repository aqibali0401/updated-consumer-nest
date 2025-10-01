import { Injectable, Inject } from '@nestjs/common';
import { LOGGER_TOKEN } from '../logger/logger.provider';

export interface DeviceTelemetryData {
  deviceId: string;
  timestamp: string;
  partitionId: string;
  sequenceNumber: number;
  offset: string;
  data: {
    eventType: string;
    deviceId: string;
    serial: string;
    name: string;
    model: string;
    uptime: number;
    modelNumber: string;
    serialNo: string;
  };
  systemProperties: any;
}

export interface TransformedDeviceData {
  core: {
    serial: string;
    name: string;
    model: string;
    firmware: string;
    access: string;
    uptime: number;
    status: {
      code: number;
      name: string;
    };
    modelNumber: string;
    redundancy: null;
    serialNo: null;
    isRmMode: boolean;
    isRmDebugMode: boolean;
    isNmMode: boolean;
    isNmDebugMode: boolean;
  };
  site: {
    id: number;
    name: string;
    uuid: string;
    orgId: number;
    status: string;
    siteAccountId: number;
    siteRoleId: number;
    siteRoleName: string;
    siteRoleLevel: number;
    systemRoleId: number;
    systemRoleName: string;
    systemRoleLevel: number;
  };
  accessLevel: number;
}

@Injectable()
export class TransformerService {
  constructor(@Inject(LOGGER_TOKEN) private readonly logger: any) {}

  /**
   * Transforms incoming device telemetry data to the required format
   */
  transformDeviceData(telemetryData: DeviceTelemetryData): TransformedDeviceData {
    this.logger.info('🔄 Transforming device data', {
      deviceId: telemetryData.deviceId,
      eventType: telemetryData.data.eventType
    });

    const { data } = telemetryData;

    // Transform the data according to your requirements
    const transformedData: TransformedDeviceData = {
      core: {
        serial: data.serial || data.serialNo || '',
        name: data.name || '',
        model: data.model || '',
        firmware: 'develop_integration.none.', // Default firmware as per your example
        access: 'open', // Default access as per your example
        uptime: data.uptime || 0,
        status: {
          code: 2, // Default status code for "Running"
          name: 'Running'
        },
        modelNumber: data.modelNumber || data.model || '',
        redundancy: null,
        serialNo: null, // Set to null as per your example
        isRmMode: false,
        isRmDebugMode: false,
        isNmMode: false,
        isNmDebugMode: false
      },
      site: {
        id: 1,
        name: 'Site',
        uuid: 'd14904aa-7d1c-4067-9df8-3eafb9aa01e3',
        orgId: 1,
        status: 'active',
        siteAccountId: 1,
        siteRoleId: 1,
        siteRoleName: 'manager',
        siteRoleLevel: 100,
        systemRoleId: 1,
        systemRoleName: 'admin',
        systemRoleLevel: 100
      },
      accessLevel: 100
    };

    this.logger.info('✅ Device data transformed successfully', {
      deviceId: telemetryData.deviceId,
      serial: transformedData.core.serial,
      name: transformedData.core.name,
      model: transformedData.core.model
    });

    return transformedData;
  }

  /**
   * Checks if the incoming data is a new device event
   */
  isNewDeviceEvent(telemetryData: DeviceTelemetryData): boolean {
    const isNewDevice = telemetryData.data.eventType === 'new_device';
    this.logger.info(`🔍 Checking new device event: eventType='${telemetryData.data.eventType}', isNewDevice=${isNewDevice}`);
    return isNewDevice;
  }

  /**
   * Processes device telemetry and returns transformed data if it's a new device event
   */
  processDeviceTelemetry(telemetryData: DeviceTelemetryData): TransformedDeviceData | null {
    this.logger.info(`🔍 Processing device telemetry: deviceId=${telemetryData.deviceId}, eventType='${telemetryData.data.eventType}'`);
    
    if (this.isNewDeviceEvent(telemetryData)) {
      this.logger.info('🆕 NEW DEVICE EVENT DETECTED! Processing transformation...', {
        deviceId: telemetryData.deviceId,
        eventType: telemetryData.data.eventType
      });
      
      return this.transformDeviceData(telemetryData);
    }

    this.logger.info('ℹ️ Non-new device event, skipping transformation', {
      deviceId: telemetryData.deviceId,
      eventType: telemetryData.data.eventType
    });

    return null;
  }
}
