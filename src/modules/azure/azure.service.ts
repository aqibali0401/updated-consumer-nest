import { Injectable } from '@nestjs/common';
import { Client } from 'azure-iothub';

@Injectable()
export class AzureService {
  private client: Client | null = null;

  private getClient(): Client {
    if (this.client) return this.client;
    const conn = (process.env.IOTHUB_CONNECTION_STRING || '').trim();
    if (!conn) throw new Error('IOTHUB_CONNECTION_STRING is required');
    this.client = Client.fromConnectionString(conn);
    return this.client;
  }

  async sendC2D(deviceId: string, payload: string) {
    const client = this.getClient();
    await new Promise<void>((resolve, reject) => {
      client.open((err) => {
        if (err) return reject(err);
        client.send(deviceId, payload, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async invokeMethod(deviceId: string, methodName: string, payload?: any) {
    const client = this.getClient();
    const status = await client.invokeDeviceMethod(deviceId, {
      methodName,
      ...(payload ? { payload } : {}),
      responseTimeoutInSeconds: 10,
    });
    return status;
  }
}


