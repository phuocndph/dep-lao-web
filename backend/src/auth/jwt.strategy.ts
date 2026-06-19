import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import type { JwtPayload } from './auth.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET') as string,
      ignoreExpiration: false,
    })
  }

  validate(payload: JwtPayload): { userId: string; tenantId: string; role: string } {
    return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role }
  }
}
