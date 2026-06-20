import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type IoRedis from 'ioredis'
import { ZaloController } from './zalo.controller'
import { SessionPoolService } from '../pool/session-pool.service'
import { VaultService } from '../vault/vault.service'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'

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
      useFactory: (redis: IoRedis, redisPub: IoRedis, prisma: PrismaService) =>
        new SessionPoolService(redis, redisPub, prisma),
      inject: ['REDIS', 'REDIS_PUB', PrismaService],
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
