import { Global, Module } from '@nestjs/common'
import Redis from 'ioredis'

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS',
      useFactory: () => new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379'),
    },
    {
      provide: 'REDIS_PUB',
      useFactory: () => new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379'),
    },
  ],
  exports: ['REDIS', 'REDIS_PUB'],
})
export class RedisModule {}
