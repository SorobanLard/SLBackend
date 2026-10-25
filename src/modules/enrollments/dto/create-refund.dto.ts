import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUsdcAmount } from '../../../common/validators/monetary.validator';

export class CreateRefundDto {
  @ApiProperty({ description: 'ID of the enrollment being disputed / cancelled' })
  @IsString() @IsNotEmpty()
  enrollmentId: string;

  @ApiProperty({ description: 'Reason for the refund request' })
  @IsString() @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({
    description: 'Amount requested in USDC (up to 7 decimals). Defaults to the full amount paid for the enrollment.',
  })
  @IsOptional() @IsUsdcAmount()
  requestedAmount?: number;
}
