import { Module } from '@nestjs/common'
import { ZaloSocketGateway } from './zalo-socket.gateway'
import { ZaloModule } from '../zalo/zalo.module'

@Module({
  imports: [ZaloModule],
  providers: [ZaloSocketGateway],
  exports: [ZaloSocketGateway],
})
export class GatewayModule {}
