import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SmsStatus, SmsTemplateKey } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsService } from './sms.service';

const mockGatewaySend = jest.fn();

jest.mock('africastalking', () =>
  jest.fn(() => ({
    SMS: {
      send: (...args: unknown[]) => mockGatewaySend(...args),
    },
  })),
);

describe('SmsService', () => {
  let service: SmsService;

  const mockPrisma = {
    smsMessage: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const configValues: Record<string, unknown> = {
    AFRICASTALKING_API_KEY: 'test-key',
    AFRICASTALKING_USERNAME: 'sandbox',
    AFRICASTALKING_SENDER_ID: 'SOROBANLARD',
  };

  const configGet = jest.fn((key: string, defaultValue?: unknown) =>
    configValues[key] !== undefined ? configValues[key] : defaultValue,
  );

  const gatewayResponse = (status: string, messageId?: string) => ({
    SMSMessageData: {
      Recipients: [{ status, messageId, number: '+2348012345678' }],
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get<SmsService>(SmsService);

    jest.clearAllMocks();
    configGet.mockImplementation((key: string, defaultValue?: unknown) =>
      configValues[key] !== undefined ? configValues[key] : defaultValue,
    );

    mockPrisma.smsMessage.create.mockResolvedValue({ id: 'sms-1' });
    mockPrisma.smsMessage.update.mockResolvedValue({ id: 'sms-1', status: SmsStatus.SENT });
    mockPrisma.smsMessage.findUnique.mockResolvedValue(null);
    mockGatewaySend.mockResolvedValue(gatewayResponse('Success', 'provider-1'));
  });

  describe('validatePhoneNumber()', () => {
    it('rejects an unsupported country code', () => {
      expect(() => service.validatePhoneNumber('+14155552671', 'US')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePhoneNumber('+14155552671', 'US')).toThrow(
        'Unsupported country code: US',
      );
    });

    it('rejects a number that does not match the country format', () => {
      expect(() => service.validatePhoneNumber('12345', 'NG')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePhoneNumber('12345', 'NG')).toThrow(
        'Invalid phone number format for country NG',
      );
    });

    it('rejects an empty phone number', () => {
      expect(() => service.validatePhoneNumber('   ', 'NG')).toThrow(BadRequestException);
    });

    it('normalises a local number into E.164 form', () => {
      expect(service.validatePhoneNumber('08012345678', 'NG')).toBe('+2348012345678');
    });

    it('keeps an already international number untouched', () => {
      expect(service.validatePhoneNumber('+2348012345678', 'NG')).toBe('+2348012345678');
    });

    it('trims surrounding whitespace before validating', () => {
      expect(service.validatePhoneNumber('  08012345678  ', 'NG')).toBe('+2348012345678');
    });

    it('accepts a lower-case country code', () => {
      expect(service.validatePhoneNumber('08012345678', 'ng')).toBe('+2348012345678');
    });

    it('supports the other supported countries', () => {
      expect(service.validatePhoneNumber('0712345678', 'KE')).toBe('+254712345678');
      expect(service.validatePhoneNumber('0772345678', 'UG')).toBe('+256772345678');
      expect(service.validatePhoneNumber('0241234567', 'GH')).toBe('+233241234567');
      expect(service.validatePhoneNumber('0821234567', 'ZA')).toBe('+27821234567');
      expect(service.validatePhoneNumber('0754123456', 'TZ')).toBe('+255754123456');
    });
  });

  describe('renderTemplate()', () => {
    it('renders a template with the supplied data', () => {
      const rendered = service.renderTemplate(SmsTemplateKey.ACCOUNT_VERIFICATION, {
        name: 'Ada',
        code: '123456',
        minutes: 10,
      });

      expect(rendered).toBe(
        'Hi Ada, your SorobanLard verification code is 123456. It expires in 10 minutes.',
      );
    });

    it('leaves unknown placeholders untouched', () => {
      const rendered = service.renderTemplate(SmsTemplateKey.ENROLLMENT_CONFIRMED, {
        name: 'Ada',
      });

      expect(rendered).toContain('{{courseTitle}}');
    });

    it('renders the generic alert template from the message data', () => {
      expect(
        service.renderTemplate(SmsTemplateKey.GENERIC_ALERT, { message: 'Server downtime' }),
      ).toBe('Server downtime');
    });

    it('rejects an unknown template key', () => {
      expect(() =>
        service.renderTemplate('NOT_A_TEMPLATE' as SmsTemplateKey),
      ).toThrow(BadRequestException);
    });
  });

  describe('sendSms()', () => {
    it('persists a pending record and marks it sent on success', async () => {
      const result = await service.sendSms({
        phoneNumber: '08012345678',
        countryCode: 'ng',
        userId: 'user-1',
        templateKey: SmsTemplateKey.ACCOUNT_VERIFICATION,
        templateData: { name: 'Ada', code: '123456', minutes: 10 },
      });

      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          phoneNumber: '+2348012345678',
          countryCode: 'NG',
          templateKey: SmsTemplateKey.ACCOUNT_VERIFICATION,
          status: SmsStatus.PENDING,
        }),
      });

      expect(mockGatewaySend).toHaveBeenCalledWith({
        to: ['+2348012345678'],
        message: 'Hi Ada, your SorobanLard verification code is 123456. It expires in 10 minutes.',
        from: 'SOROBANLARD',
      });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: expect.objectContaining({
          status: SmsStatus.SENT,
          providerMessageId: 'provider-1',
          failureReason: null,
        }),
      });
      expect(result).toEqual({ id: 'sms-1', status: SmsStatus.SENT });
    });

    it('sends a raw message when no template key is provided', async () => {
      await service.sendSms({
        phoneNumber: '+2348012345678',
        countryCode: 'NG',
        message: 'Your enrollment is confirmed',
      });

      expect(mockGatewaySend).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Your enrollment is confirmed' }),
      );
      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ templateKey: undefined, message: 'Your enrollment is confirmed' }),
      });
    });

    it('rejects the send when neither a template nor a message is provided', async () => {
      await expect(
        service.sendSms({ phoneNumber: '08012345678', countryCode: 'NG' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.smsMessage.create).not.toHaveBeenCalled();
      expect(mockGatewaySend).not.toHaveBeenCalled();
    });

    it('does not persist anything when the phone number is invalid', async () => {
      await expect(
        service.sendSms({ phoneNumber: '12345', countryCode: 'NG', message: 'hi' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.smsMessage.create).not.toHaveBeenCalled();
    });

    it('marks the message failed when the gateway reports a non-success status', async () => {
      mockGatewaySend.mockResolvedValueOnce(gatewayResponse('Rejected', undefined));

      await service.sendSms({
        phoneNumber: '08012345678',
        countryCode: 'NG',
        message: 'Your enrollment is confirmed',
      });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: {
          status: SmsStatus.FAILED,
          providerMessageId: undefined,
          failureReason: 'Rejected',
          sentAt: null,
        },
      });
    });

    it('marks the message failed when the gateway throws', async () => {
      mockGatewaySend.mockRejectedValueOnce(new Error('gateway offline'));

      const result = await service.sendSms({
        phoneNumber: '08012345678',
        countryCode: 'NG',
        message: 'Your enrollment is confirmed',
      });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: { status: SmsStatus.FAILED, failureReason: 'gateway offline' },
      });
      expect(result).toEqual({ id: 'sms-1', status: SmsStatus.SENT });
    });
  });

  describe('getDeliveryStatus()', () => {
    it('returns the stored message for the given id', async () => {
      mockPrisma.smsMessage.findUnique.mockResolvedValueOnce({
        id: 'sms-1',
        status: SmsStatus.DELIVERED,
      });

      await expect(service.getDeliveryStatus('sms-1')).resolves.toEqual({
        id: 'sms-1',
        status: SmsStatus.DELIVERED,
      });
      expect(mockPrisma.smsMessage.findUnique).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
      });
    });
  });

  describe('handleDeliveryCallback()', () => {
    it('acknowledges without updating when the provider message is unknown', async () => {
      mockPrisma.smsMessage.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.handleDeliveryCallback({ id: 'provider-unknown', status: 'Success' }),
      ).resolves.toEqual({ acknowledged: false });
      expect(mockPrisma.smsMessage.update).not.toHaveBeenCalled();
    });

    it('marks the message delivered on a success callback', async () => {
      mockPrisma.smsMessage.findUnique.mockResolvedValueOnce({ id: 'sms-1' });

      await expect(
        service.handleDeliveryCallback({ id: 'provider-1', status: 'Success' }),
      ).resolves.toEqual({ acknowledged: true });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: {
          status: SmsStatus.DELIVERED,
          deliveredAt: expect.any(Date),
          failureReason: null,
        },
      });
    });

    it('treats a delivered status as delivered regardless of casing', async () => {
      mockPrisma.smsMessage.findUnique.mockResolvedValueOnce({ id: 'sms-1' });

      await service.handleDeliveryCallback({ id: 'provider-1', status: 'Delivered' });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: expect.objectContaining({ status: SmsStatus.DELIVERED }),
      });
    });

    it('marks the message failed for any other callback status', async () => {
      mockPrisma.smsMessage.findUnique.mockResolvedValueOnce({ id: 'sms-1' });

      await expect(
        service.handleDeliveryCallback({ id: 'provider-1', status: 'Rejected' }),
      ).resolves.toEqual({ acknowledged: true });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: {
          status: SmsStatus.FAILED,
          deliveredAt: null,
          failureReason: 'Rejected',
        },
      });
    });
  });
});
