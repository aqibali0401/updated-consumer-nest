import { Provider } from '@nestjs/common';
import * as winston from 'winston';
import { format, transports, Logger } from 'winston';
import * as path from 'path';
import 'winston-daily-rotate-file';

export const LOGGER_TOKEN = 'APP_LOGGER';

export const createLogger: Provider<Logger> = {
  provide: LOGGER_TOKEN,
  useFactory: () => {
    const retainingPeriod = process.env.LOG_RETAIN_PERIOD || '1d';
    const cwd = process.cwd();
    const baseErrorFolderPath = path.join(cwd, 'logs');
    const logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: format.combine(
        format.errors({ stack: true }),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.prettyPrint()
      ),
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize({ all: true }),
            format.printf((log) => `${(log as any).timestamp} ${log.level}: ${log.message}`)
          ),
        }),
        new transports.DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'combined-logs/combined-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
        }),
        new transports.DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'error-logs/error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
          level: 'warn',
          format: format.combine(format.timestamp(), format.json()),
        }),
      ],
      exceptionHandlers: [
        new transports.DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'exceptions/exceptions-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
        }),
      ],
      rejectionHandlers: [
        new transports.DailyRotateFile({
          filename: path.join(baseErrorFolderPath, 'rejections/rejections-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: retainingPeriod,
        }),
      ],
    });
    return logger;
  },
};


