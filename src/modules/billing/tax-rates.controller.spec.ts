import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import {
  BadRequestException,
  ExecutionContext,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { TaxRatesController } from './tax-rates.controller';
import { FeeCalculatorService } from './fee-calculator.service';
import { UpsertTaxRateDto } from './dto/upsert-tax-rate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('TaxRatesController', () => {
  let controller: TaxRatesController;

  const mockFeeCalculatorService = {
    listTaxRates: jest.fn(),
    upsertTaxRate: jest.fn(),
    removeTaxRate: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TaxRatesController],
      providers: [
        { provide: FeeCalculatorService, useValue: mockFeeCalculatorService },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<TaxRatesController>(TaxRatesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('guard and decorator metadata', () => {
    it('applies JwtAuthGuard and RolesGuard at the controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, TaxRatesController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    });

    it('restricts the controller to the ADMIN role and enforces it via RolesGuard', () => {
      expect(Reflect.getMetadata(ROLES_KEY, TaxRatesController)).toEqual([
        UserRole.ADMIN,
      ]);

      const rolesGuard = new RolesGuard(new Reflector());
      const buildContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => controller.findAll,
          getClass: () => TaxRatesController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u-1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(buildContext(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(buildContext(UserRole.INSTRUCTOR))).toBe(false);
      expect(rolesGuard.canActivate(buildContext(UserRole.ADMIN))).toBe(true);
    });

    it('configures HTTP 200 OK status metadata on remove', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.remove)).toBe(
        HttpStatus.OK,
      );
    });
  });

  describe('route delegation', () => {
    it('findAll delegates to feeCalculator.listTaxRates', async () => {
      const expected = [{ region: 'NG', ratePercent: 7.5, description: 'Nigeria VAT', isActive: true }];
      mockFeeCalculatorService.listTaxRates.mockResolvedValue(expected);

      const res = await controller.findAll();

      expect(mockFeeCalculatorService.listTaxRates).toHaveBeenCalledTimes(1);
      expect(res).toEqual(expected);
    });

    it('upsert delegates to feeCalculator.upsertTaxRate with region and UpsertTaxRateDto', async () => {
      const dto: UpsertTaxRateDto = {
        ratePercent: 7.5,
        description: 'Nigeria VAT',
        isActive: true,
      };
      const expected = { region: 'NG', ...dto };
      mockFeeCalculatorService.upsertTaxRate.mockResolvedValue(expected);

      const res = await controller.upsert('NG', dto);

      expect(mockFeeCalculatorService.upsertTaxRate).toHaveBeenCalledWith('NG', dto);
      expect(res).toEqual(expected);
    });

    it('remove delegates to feeCalculator.removeTaxRate with region', async () => {
      const expected = { removed: true, region: 'NG' };
      mockFeeCalculatorService.removeTaxRate.mockResolvedValue(expected);

      const res = await controller.remove('NG');

      expect(mockFeeCalculatorService.removeTaxRate).toHaveBeenCalledWith('NG');
      expect(res).toEqual(expected);
    });

    it('propagates service errors when upsert rejects', async () => {
      mockFeeCalculatorService.upsertTaxRate.mockRejectedValue(
        new BadRequestException('Invalid tax rate region'),
      );

      await expect(
        controller.upsert('', { ratePercent: 7.5 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('UpsertTaxRateDto validation', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    it('accepts valid tax rate payloads within 0–100% and up to 2 decimal places', async () => {
      const validated = await pipe.transform(
        { ratePercent: 7.5, description: 'Nigeria VAT', isActive: true },
        { type: 'body', metatype: UpsertTaxRateDto },
      );

      expect(validated).toBeInstanceOf(UpsertTaxRateDto);
      expect(validated).toMatchObject({
        ratePercent: 7.5,
        description: 'Nigeria VAT',
        isActive: true,
      });
    });

    it('rejects out-of-range or over-precise ratePercent values', async () => {
      await expect(
        pipe.transform(
          { ratePercent: -1 },
          { type: 'body', metatype: UpsertTaxRateDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { ratePercent: 105 },
          { type: 'body', metatype: UpsertTaxRateDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { ratePercent: 7.555 },
          { type: 'body', metatype: UpsertTaxRateDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
