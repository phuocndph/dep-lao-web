import { Controller, Post, Get, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import type { Request } from 'express'
import { AuthService, AuthResponse, AuthUserInfo } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { JwtAuthGuard } from './guards/jwt-auth.guard'

interface RefreshBody {
  refreshToken: string
}

interface LogoutBody {
  refreshToken: string
}

interface RequestWithUser extends Request {
  user: { userId: string; tenantId: string; role: string }
}

@Controller('/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(dto)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(dto)
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshBody): Promise<AuthResponse> {
    return this.authService.refresh(body.refreshToken)
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: LogoutBody): Promise<void> {
    return this.authService.logout(body.refreshToken)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: RequestWithUser): Promise<AuthUserInfo> {
    return this.authService.getMe(req.user.userId)
  }
}
