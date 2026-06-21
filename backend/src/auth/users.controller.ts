import { Controller, Get, Post, Delete, Param, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common'
import type { Request } from 'express'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { AuthService } from './auth.service'
import { CreateUserDto } from './dto/create-user.dto'

interface RequestWithUser extends Request {
  user: { userId: string; tenantId: string; role: string }
}

@Controller('/api/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  async listUsers(@Req() req: RequestWithUser) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.authService.listUsers(req.user.tenantId)
  }

  @Post()
  async createUser(@Body() dto: CreateUserDto, @Req() req: RequestWithUser) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.authService.createUser(req.user.tenantId, dto)
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string, @Req() req: RequestWithUser) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.authService.deleteUser(req.user.tenantId, id)
  }
}
