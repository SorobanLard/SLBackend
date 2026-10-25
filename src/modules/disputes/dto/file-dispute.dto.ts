import { IsString, IsNotEmpty, IsEnum, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DisputeReferenceType } from '@prisma/client';

export class FileDisputeDto {
  @ApiProperty({ enum: DisputeReferenceType, description: 'Whether the dispute is about an enrollment or a payment' })
  @IsEnum(DisputeReferenceType)
  referenceType: DisputeReferenceType;

  @ApiProperty({
    description: 'The enrollment ID (UUID) or payment transaction hash being disputed',
    example: 'a1b2c3d4-...',
  })
  @IsString()
  @IsNotEmpty()
  referenceId: string;

  @ApiProperty({ example: 'Course content does not match description' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: 'Subject must not exceed 200 characters' })
  subject: string;

  @ApiProperty({ example: 'The course advertised 20 hours of video content but only has 5.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000, { message: 'Description must not exceed 5000 characters' })
  description: string;
}
