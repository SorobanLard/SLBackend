import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TaxRatesController } from './tax-rates.controller';
import { FeeCalculatorService } from './fee-calculator.service';
import { UpsertTaxRateDto } from './dto/upsert-tax-rate.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../common/guards/roles.guard';

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

  describe('findAll (GET /admin/tax-rates)', () => {
    it('delegates to FeeCalculatorService.listTaxRates and returns configured rates', async () => {
      const expected = [
        { region: 'DEFAULT', ratePercent: 0, isActive: true },
        { region: 'NG', ratePercent: 7.5, description: 'Nigeria VAT', isActive: true },
      ];
      mockFeeCalculatorService.listTaxRates.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(result).toEqual(expected);
      expect(mockFeeCalculatorService.listTaxRates).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsert (PUT /admin/tax-rates/:region)', () => {
    it('delegates to FeeCalculatorService.upsertTaxRate with region and dto', async () => {
      const dto: UpsertTaxRateDto = {
        ratePercent: 7.5,
        description: 'Nigeria VAT',
        isActive: true,
      };
      const expected = {
        region: 'NG',
        ratePercent: 7.5,
        description: 'Nigeria VAT',
        isActive: true,
      };
      mockFeeCalculatorService.upsertTaxRate.mockResolvedValue(expected);

      const result = await controller.upsert('NG', dto);

      expect(result).toEqual(expected);
      expect(mockFeeCalculatorService.upsertTaxRate).toHaveBeenCalledWith(
        'NG',
        dto,
      );
    });
  });

  describe('remove (DELETE /admin/tax-rates/:region)', () => {
    it('delegates to FeeCalculatorService.removeTaxRate with region', async () => {
      const expected = { region: 'NG', deleted: true };
      mockFeeCalculatorService.removeTaxRate.mockResolvedValue(expected);

      const result = await controller.remove('NG');

      expect(result).toEqual(expected);
      expect(mockFeeCalculatorService.removeTaxRate).toHaveBeenCalledWith('NG');
    });

    it('declares HTTP 200 OK status code metadata', () => {
      const status = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        TaxRatesController.prototype.remove,
      );
      expect(status).toBe(HttpStatus.OK);
    });

    it('propagates NotFoundException when region has no configured tax rate', async () => {
      mockFeeCalculatorService.removeTaxRate.mockRejectedValue(
        new NotFoundException('No tax rate configured for region "ZZ"'),
      );

      await expect(controller.remove('ZZ')).rejects.toThrow(NotFoundException);
    });
  });

  describe('guard wiring and DTO validation', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, TaxRatesController);
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    });

    it('restricts the controller to ADMIN role via Reflector metadata', () => {
      const reflector = new Reflector();
      const roles = reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        TaxRatesController.prototype.findAll,
        TaxRatesController,
      ]);
      expect(roles).toEqual([UserRole.ADMIN]);
      expect(Reflect.getMetadata(ROLES_KEY, TaxRatesController)).toEqual([
        UserRole.ADMIN,
      ]);
    });

    it('denies non-ADMIN callers via RolesGuard', () => {
      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => TaxRatesController.prototype.upsert,
          getClass: () => TaxRatesController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(makeContext(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(makeContext(UserRole.INSTRUCTOR))).toBe(
        false,
      );
      expect(rolesGuard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
    });

    it('validates UpsertTaxRateDto bounds (0-100, max 2 decimal places)', async () => {
      const validDto = plainToInstance(UpsertTaxRateDto, {
        ratePercent: 7.5,
        description: 'Nigeria VAT',
        isActive: true,
      });
      expect(await validate(validDto)).toHaveLength(0);

      const negativeDto = plainToInstance(UpsertTaxRateDto, {
        ratePercent: -1,
      });
      expect((await validate(negativeDto)).length).toBeGreaterThan(0);

      const overMaxDto = plainToInstance(UpsertTaxRateDto, {
        ratePercent: 105,
      });
      expect((await validate(overMaxDto)).length).toBeGreaterThan(0);

      const tooManyDecimalsDto = plainToInstance(UpsertTaxRateDto, {
        ratePercent: 7.555,
      });
      expect((await validate(tooManyDecimalsDto)).length).toBeGreaterThan(0);
    });
  });
});
