import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ description: 'Discussion thread or entity identifier' })
  @IsString()
  @IsNotEmpty()
  discussionId: string;

  @ApiProperty({ description: 'Comment content to be scanned for banned terms' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000, { message: 'Comment content must not exceed 5000 characters' })
  content: string;
}
