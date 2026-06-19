import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RedisModule } from './redis/redis.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { ZaloModule } from './zalo/zalo.module.js'
import { GatewayModule } from './gateway/gateway.module.js'
import {
  VaultInternalController,
  VaultPublicController,
} from './vault/vault-internal.controller.js'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    PrismaModule,
    ZaloModule,
    GatewayModule,
  ],
  controllers: [VaultInternalController, VaultPublicController],
})
export class AppModule {}
