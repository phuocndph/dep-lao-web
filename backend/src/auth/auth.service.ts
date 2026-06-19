import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import type { User } from '@prisma/client'

export interface JwtPayload {
  sub: string
  tenantId: string
  role: string
  email: string
}

export interface AuthUserInfo {
  id: string
  email: string
  displayName: string
  role: string
  tenantId: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  user: AuthUserInfo
}

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const tenant = await this.prisma.tenant.upsert({
      where: { slug: dto.tenantSlug },
      create: { name: dto.tenantName, slug: dto.tenantSlug },
      update: {},
    })

    const existing = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id, email: dto.email },
    })
    if (existing) throw new ConflictException('Email already registered in this tenant')

    const passwordHash = await bcrypt.hash(dto.password, 12)
    const user = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
        role: 'ADMIN',
      },
    })

    return this.generateTokens(user, tenant.id)
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const invalid = () => new UnauthorizedException('Invalid credentials')

    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } })
    if (!tenant) throw invalid()

    const user = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id, email: dto.email, isActive: true },
    })
    if (!user) throw invalid()

    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) throw invalid()

    return this.generateTokens(user, tenant.id)
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const session = await this.prisma.userSession.findUnique({ where: { refreshToken } })
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired')
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } })
    if (!user) throw new UnauthorizedException('User not found')

    await this.prisma.userSession.delete({ where: { id: session.id } })

    return this.generateTokens(user, user.tenantId)
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.userSession.deleteMany({ where: { refreshToken } })
  }

  async getMe(userId: string): Promise<AuthUserInfo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, role: true, tenantId: true, createdAt: true },
    })
    if (!user) throw new UnauthorizedException('User not found')
    return user
  }

  private async generateTokens(user: User, tenantId: string): Promise<AuthResponse> {
    const payload: JwtPayload = { sub: user.id, tenantId, role: user.role, email: user.email }

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: '15m',
    })

    const refreshToken = crypto.randomUUID()
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    })

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        tenantId,
      },
    }
  }
}
