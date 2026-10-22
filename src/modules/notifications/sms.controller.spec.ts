import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SmsTemplateKey, UserRole } from '@prisma/client';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('SmsController', () => {
  let controller: SmsController;

  const mockSmsService = {
    sendSms: jest.fn(),
    getDeliveryStatus: jest.fn(),
    handleDeliveryCallback: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SmsController],
      providers: [{ provide: SmsService, useValue: mockSmsService }],
    }).compile();

    controller = module.get<SmsController>(SmsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('sendSms', () => {
    it('delegates to SmsService.sendSms with the assembled payload', async () => {
      mockSmsService.sendSms.mockResolvedValue({ id: 'sms-1' });
      const templateKey = Object.values(SmsTemplateKey)[0] as SmsTemplateKey;

      const res = await controller.sendSms('5551234', '+1', 'user-1', templateKey, { name: 'Ada' }, 'hi');

      expect(mockSmsService.sendSms).toHaveBeenCalledWith({
        phoneNumber: '5551234',
        countryCode: '+1',
        userId: 'user-1',
        templateKey,
        templateData: { name: 'Ada' },
        message: 'hi',
      });
      expect(res).toEqual({ id: 'sms-1' });
    });
  });

  describe('getStatus', () => {
    it('delegates to SmsService.getDeliveryStatus', async () => {
      mockSmsService.getDeliveryStatus.mockResolvedValue({ status: 'DELIVERED' });

      const res = await controller.getStatus('sms-1');

      expect(mockSmsService.getDeliveryStatus).toHaveBeenCalledWith('sms-1');
      expect(res).toEqual({ status: 'DELIVERED' });
    });
  });

  describe('handleCallback', () => {
    it('delegates to SmsService.handleDeliveryCallback', async () => {
      const payload = { id: 'sms-1', status: 'DELIVERED' };
      mockSmsService.handleDeliveryCallback.mockResolvedValue({ ok: true });

      const res = await controller.handleCallback(payload);

      expect(mockSmsService.handleDeliveryCallback).toHaveBeenCalledWith(payload);
      expect(res).toEqual({ ok: true });
    });
  });

  describe('guard wiring', () => {
    it.each(['sendSms', 'getStatus'] as const)('%s is protected by JwtAuthGuard + RolesGuard for ADMIN', (method) => {
      const handler = SmsController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    });

    it('leaves the gateway callback unguarded', () => {
      const handler = SmsController.prototype.handleCallback;
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, SmsController)).toBeUndefined();
    });
  });
});
