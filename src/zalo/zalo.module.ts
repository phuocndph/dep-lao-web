import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type IoRedis from 'ioredis'
import { ZaloController } from './zalo.controller.js'
import { SessionPoolService } from '../pool/session-pool.service.js'
import { VaultService } from '../vault/vault.service.js'
import { PrismaModule } from '../prisma/prisma.module.js'

@Module({
  imports: [PrismaModule],
  controllers: [ZaloController],
  providers: [
    {
      provide: VaultService,
      useFactory: (config: ConfigService) =>
        new VaultService(config.get<string>('MASTER_KEY') ?? ''),
      inject: [ConfigService],
    },
    {
      provide: SessionPoolService,
      useFactory: (redis: IoRedis, redisPub: IoRedis) =>
        new SessionPoolService(redis, redisPub),
      inject: ['REDIS', 'REDIS_PUB'],
    },
  ],
  exports: [SessionPoolService, VaultService],
})
export class ZaloModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly pool: SessionPoolService) {}

  async onModuleInit(): Promise<void> {
    await this.pool.start()
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.stop()
  }
}
