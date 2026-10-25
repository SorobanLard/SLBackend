import {
  IsString, IsNotEmpty, IsEnum, IsNumber,
  IsOptional, IsInt, IsDate, IsBoolean,
  Min, IsPositive, Matches,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DiscountType } from '@prisma/client';
import {
  IsFutureDate,
  IsPercentageAtMost,
  IsUsdcAmount,
} from '../../../common/validators/monetary.validator';

export class CreateCouponDto {
  @ApiProperty({ example: 'SAVE20', description: 'Unique coupon code (case-insensitive, stored uppercase)' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9_-]{3,50}$/i, {
    message: 'Coupon code must be 3-50 characters containing only letters, numbers, hyphens, or underscores',
  })
  code: string;

  @ApiProperty({ enum: DiscountType, example: DiscountType.PERCENTAGE })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({
    example: 20,
    description: 'Percentage value (0-100) for PERCENTAGE type, or fixed USDC amount (up to 7 decimals) for FIXED type',
  })
  @IsNumber()
  @IsPositive()
  @IsUsdcAmount({
    condition: (coupon) => coupon.discountType === DiscountType.FIXED,
  })
  @IsPercentageAtMost(100, (coupon) => coupon.discountType === DiscountType.PERCENTAGE)
  discountValue: number;

  @ApiProperty({
    required: false,
    example: 100,
    description: 'Maximum number of times this coupon can be redeemed. Null means unlimited.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxRedemptions?: number;

  @ApiProperty({
    required: false,
    example: 10,
    description: 'Minimum order amount in USDC required to use this coupon (up to 7 decimals)',
  })
  @IsOptional()
  @IsUsdcAmount({ allowZero: true })
  minOrderAmount?: number;

  @ApiProperty({ required: false, description: 'Expiry date. Null means never expires.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @IsFutureDate()
  expiresAt?: Date;

  @ApiProperty({ required: false, description: 'Restrict coupon to a specific course ID' })
  @IsOptional()
  @IsString()
  courseId?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
