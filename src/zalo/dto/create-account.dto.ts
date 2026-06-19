import { IsString, IsNotEmpty, IsUUID, IsOptional } from 'class-validator'

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  phone!: string

  @IsUUID()
  tenantId!: string

  @IsOptional()
  @IsString()
  displayName?: string
}
