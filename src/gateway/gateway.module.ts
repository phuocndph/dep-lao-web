import { Module } from '@nestjs/common'
import { ZaloSocketGateway } from './zalo-socket.gateway.js'
import { ZaloModule } from '../zalo/zalo.module.js'

@Module({
  imports: [ZaloModule],
  providers: [ZaloSocketGateway],
  exports: [ZaloSocketGateway],
})
export class GatewayModule {}
