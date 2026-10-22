import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsBoolean,
  IsInt,
  IsUrl,
  IsIn,
  Matches,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VALID_ORIENTATIONS } from '../certificate-template.types';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const HEX_COLOR = /^#([0-9A-Fa-f]{6})$/;

export class CertificateBrandingDto {
  @ApiPropertyOptional({ example: 'SorobanLard Academy', description: 'Organization name printed on the certificate' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  organizationName?: string;

  @ApiPropertyOptional({ example: '#1A365D', description: 'Primary brand color as #RRGGBB' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'primaryColor must be a hex color in the form #RRGGBB' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#C9A227', description: 'Secondary/accent color as #RRGGBB' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'secondaryColor must be a hex color in the form #RRGGBB' })
  secondaryColor?: string;

  @ApiPropertyOptional({ example: 'https://cdn.sorobanlard.com/brand/logo.png' })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  backgroundImageUrl?: string;

  @ApiPropertyOptional({ example: 'Times-Roman' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fontFamily?: string;

  @ApiPropertyOptional({ example: 'Verify this credential at sorobanlard.com/certificates' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  footerText?: string;
}

export class CertificateLayoutDto {
  @ApiPropertyOptional({ enum: VALID_ORIENTATIONS, example: 'LANDSCAPE' })
  @IsOptional()
  @IsIn(VALID_ORIENTATIONS)
  orientation?: 'PORTRAIT' | 'LANDSCAPE';

  @ApiPropertyOptional({ example: 'Certificate of Completion' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  titleText?: string;

  @ApiPropertyOptional({ example: 'Vocational Skills Programme' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitleText?: string;

  @ApiPropertyOptional({
    example: 'This certifies that {{studentName}} has successfully completed {{courseTitle}}.',
    description: 'Body copy. Supports {{studentName}}, {{courseTitle}}, {{issueDate}}, {{certificateId}}, {{category}}, {{organizationName}}.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  bodyText?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showQrCode?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showIssueDate?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showCertificateId?: boolean;

  @ApiPropertyOptional({ example: 48, description: 'Page margin in PDF points (20–80)' })
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(80)
  margin?: number;
}

export class CertificateSignatureDto {
  @ApiProperty({ example: 'Ada Lovelace', description: 'Signatory display name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Director of Education', description: 'Role/label shown under the signature line' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @ApiPropertyOptional({ example: 'PhD' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  imageUrl?: string;
}

export class CreateCertificateTemplateDto {
  @ApiProperty({ example: 'Tailoring — Classic Landscape' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Tailoring', description: 'Course category this template applies to' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category: string;

  @ApiPropertyOptional({ type: CertificateBrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CertificateBrandingDto)
  branding?: CertificateBrandingDto;

  @ApiPropertyOptional({ type: CertificateLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CertificateLayoutDto)
  layout?: CertificateLayoutDto;

  @ApiPropertyOptional({ type: [CertificateSignatureDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificateSignatureDto)
  signatures?: CertificateSignatureDto[];
}

export class UpdateCertificateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'Tailoring' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ type: CertificateBrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CertificateBrandingDto)
  branding?: CertificateBrandingDto;

  @ApiPropertyOptional({ type: CertificateLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CertificateLayoutDto)
  layout?: CertificateLayoutDto;

  @ApiPropertyOptional({ type: [CertificateSignatureDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificateSignatureDto)
  signatures?: CertificateSignatureDto[];
}

export class PreviewCertificateTemplateDto {
  @ApiPropertyOptional({ example: 'Jane Okonkwo' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  studentName?: string;

  @ApiPropertyOptional({ example: 'Professional Tailoring' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  courseTitle?: string;

  @ApiPropertyOptional({ example: 'CERT-PREVIEW' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  certificateId?: string;
}

export class QueryCertificateTemplatesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Tailoring' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
