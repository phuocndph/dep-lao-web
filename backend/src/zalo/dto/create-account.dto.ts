import { IsString, IsNotEmpty, IsOptional } from 'class-validator'

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  phone!: string

  @IsOptional()
  @IsString()
  displayName?: string
}
