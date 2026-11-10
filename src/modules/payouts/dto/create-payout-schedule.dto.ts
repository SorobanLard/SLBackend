import {
  IsEnum, IsNumber, IsOptional, IsString,
  IsNotEmpty, Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PayoutFrequency } from '@prisma/client';
import { IsStellarAddress } from '../../../common/validators/is-stellar-address.validator';

export class CreatePayoutScheduleDto {
  @ApiProperty({
    enum: PayoutFrequency,
    default: PayoutFrequency.MONTHLY,
    description: 'How often payouts should be triggered',
  })
  @IsEnum(PayoutFrequency)
  frequency: PayoutFrequency;

  @ApiProperty({
    example: 10,
    description: 'Minimum USDC balance required before a payout is processed',
    default: 10,
  })
  @IsNumber()
  @Min(1)
  minimumThreshold: number;

  @ApiProperty({
    example: 'GXXXXXXX...',
    description: 'Stellar address to receive the payout. Defaults to your registered address.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsStellarAddress()
  stellarAddress?: string;
}
