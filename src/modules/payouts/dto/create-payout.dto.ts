import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { PayoutStatus } from '@prisma/client';
import { IsUsdcAmount } from '../../../common/validators/monetary.validator';

export class CreatePayoutDto {
  @IsString()
  instructorId: string;

  @IsUsdcAmount()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}

export class UpdatePayoutStatusDto {
  @IsEnum(PayoutStatus)
  status: PayoutStatus;

  @IsOptional()
  @IsString()
  txHash?: string;
}
