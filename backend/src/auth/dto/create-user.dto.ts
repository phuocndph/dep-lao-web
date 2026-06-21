import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateUserDto {
  @IsEmail()
  email: string

  @IsString()
  @MinLength(8)
  password: string

  @IsString()
  displayName: string

  @IsOptional()
  @IsEnum(['ADMIN', 'MANAGER', 'EMPLOYEE'])
  role?: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
}
