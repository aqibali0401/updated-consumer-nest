import { Global, Module } from '@nestjs/common';
import { createLogger } from './logger.provider';

@Global()
@Module({
  providers: [createLogger],
  exports: [createLogger],
})
export class LoggerModule {}


