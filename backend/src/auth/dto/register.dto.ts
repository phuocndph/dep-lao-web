import { IsEmail, IsString, MinLength, IsNotEmpty, Matches } from 'class-validator'

export class RegisterDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  password!: string

  @IsString()
  @IsNotEmpty()
  displayName!: string

  @IsString()
  @IsNotEmpty()
  tenantName!: string

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'tenantSlug must contain only lowercase letters, numbers, and hyphens' })
  tenantSlug!: string
}
