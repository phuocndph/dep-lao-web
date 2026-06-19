import { IsString, IsNotEmpty, IsIn, MaxLength, IsOptional } from 'class-validator'

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  threadId!: string

  @IsIn(['user', 'group'])
  threadType!: 'user' | 'group'

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string
}

export class AddFriendDto {
  @IsString()
  @IsNotEmpty()
  userId!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string
}
