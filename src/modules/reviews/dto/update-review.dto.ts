import { IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateReviewDto {
  @ApiProperty({ required: false, example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiProperty({ required: false, example: 'Updated thoughts on the course.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Comment must not exceed 1000 characters' })
  comment?: string;
}
