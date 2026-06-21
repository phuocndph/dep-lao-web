import { Module } from '@nestjs/common'
import { CrmController } from './crm.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [CrmController],
})
export class CrmModule {}
