import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { RedisModule } from './redis/redis.module'
import { PrismaModule } from './prisma/prisma.module'
import { ZaloModule } from './zalo/zalo.module'
import { GatewayModule } from './gateway/gateway.module'
import { AuthModule } from './auth/auth.module'
import { VaultInternalController, VaultPublicController } from './vault/vault-internal.controller'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    PrismaModule,
    AuthModule,
    ZaloModule,
    GatewayModule,
  ],
  controllers: [VaultInternalController, VaultPublicController],
})
export class AppModule {}
