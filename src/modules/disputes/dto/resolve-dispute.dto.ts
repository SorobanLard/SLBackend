import { IsString, IsNotEmpty, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DisputeStatus } from '@prisma/client';

export class ResolveDisputeDto {
  @ApiProperty({
    enum: DisputeStatus,
    description: 'The final status to set on the dispute',
  })
  @IsEnum(DisputeStatus)
  status: DisputeStatus;

  @ApiProperty({ example: 'We reviewed the enrollment and confirmed a partial refund was issued.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000, { message: 'Admin notes must not exceed 3000 characters' })
  adminNotes: string;
}
