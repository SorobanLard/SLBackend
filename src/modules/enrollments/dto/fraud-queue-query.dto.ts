import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { FraudFlagStatus, FraudRiskLevel } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Filters for the admin fraud review queue. */
export class FraudQueueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FraudFlagStatus })
  @IsOptional()
  @IsEnum(FraudFlagStatus)
  status?: FraudFlagStatus;

  @ApiPropertyOptional({ enum: FraudRiskLevel })
  @IsOptional()
  @IsEnum(FraudRiskLevel)
  riskLevel?: FraudRiskLevel;
}
