import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectRefundDto {
  @ApiProperty({ description: 'Reason the refund request was rejected' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000, { message: 'Reason must not exceed 2000 characters' })
  reason: string;
}
