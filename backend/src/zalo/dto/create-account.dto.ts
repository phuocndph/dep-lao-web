import { IsString, IsOptional } from 'class-validator'

export class CreateAccountDto {
  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  displayName?: string
}
