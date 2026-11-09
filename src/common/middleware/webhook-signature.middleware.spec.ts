import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';
import {
  WebhookSignatureMiddleware,
  safeCompare,
} from './webhook-signature.middleware';

describe('WebhookSignatureMiddleware', () => {
  const defaultSecret = 'test-webhook-secret-key';
  const stripeSecret = 'stripe-webhook-secret-key';
  const sampleBody = Buffer.from(
    JSON.stringify({ id: 'evt_123', type: 'payment.succeeded' }),
    'utf8',
  );

  const signBody = (body: Buffer, secret: string): string =>
    crypto.createHmac('sha256', secret).update(body).digest('hex');

  let middleware: WebhookSignatureMiddleware;
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'WEBHOOK_SECRET') return defaultSecret;
        if (key === 'WEBHOOK_SECRET_STRIPE') return stripeSecret;
        return undefined;
      }),
    } as unknown as ConfigService;

    middleware = new WebhookSignatureMiddleware(configService, new Reflector());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('safeCompare (timing-safe buffer comparison)', () => {
    it('uses crypto.timingSafeEqual on equal-length Buffers for valid and invalid same-length hex signatures', () => {
      const spy = jest.spyOn(crypto, 'timingSafeEqual');
      const expectedHex = signBody(sampleBody, defaultSecret);
      // Flip the first hex character so a naive === check would exit on index 0,
      // while timingSafeEqual still compares two full 32-byte Buffers.
      const flippedFirstChar =
        (expectedHex[0] === 'a' ? 'b' : 'a') + expectedHex.slice(1);

      expect(safeCompare(expectedHex, flippedFirstChar)).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
      const [bufA, bufB] = spy.mock.calls[0];
      expect(Buffer.isBuffer(bufA)).toBe(true);
      expect(Buffer.isBuffer(bufB)).toBe(true);
      expect((bufA as Buffer).length).toBe(32);
      expect((bufB as Buffer).length).toBe(32);

      expect(safeCompare(expectedHex, expectedHex)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('rejects non-hex strings of the same character length without throwing RangeError', () => {
      const expectedHex = signBody(sampleBody, defaultSecret);
      const nonHexSameLength = 'z'.repeat(expectedHex.length);

      expect(safeCompare(expectedHex, nonHexSameLength)).toBe(false);
      expect(safeCompare(expectedHex, 'abcd')).toBe(false);
      expect(safeCompare('', '')).toBe(false);
    });
  });

  describe('middleware execution', () => {
    it('calls next() when X-Webhook-Signature matches sha256=<hex>', () => {
      const validHex = signBody(sampleBody, defaultSecret);
      const next = jest.fn();
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: { 'x-webhook-signature': `sha256=${validHex}` },
        rawBody: sampleBody,
      };

      middleware.use(req, {} as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid signature of the exact same length via timingSafeEqual with ForbiddenException', () => {
      const timingSpy = jest.spyOn(crypto, 'timingSafeEqual');
      const validHex = signBody(sampleBody, defaultSecret);
      const sameLengthInvalidHex =
        (validHex[0] === '0' ? '1' : '0') + validHex.slice(1);
      const next = jest.fn();
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: { 'x-webhook-signature': `sha256=${sameLengthInvalidHex}` },
        rawBody: sampleBody,
      };

      expect(() => middleware.use(req, {} as any, next)).toThrow(
        ForbiddenException,
      );
      expect(timingSpy).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    it('verifies Stripe-Signature header using provider-specific WEBHOOK_SECRET_STRIPE', () => {
      const validStripeHex = signBody(sampleBody, stripeSecret);
      const next = jest.fn();
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/stripe',
        headers: {
          'stripe-signature': `t=1735689600,v1=${validStripeHex}`,
        },
        rawBody: sampleBody,
      };

      middleware.use(req, {} as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('throws UnauthorizedException when signature header is missing', () => {
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: {},
        rawBody: sampleBody,
      };

      expect(() => middleware.use(req, {} as any, jest.fn())).toThrow(
        UnauthorizedException,
      );
    });

    it('throws ForbiddenException when rawBody is missing or empty', () => {
      const validHex = signBody(sampleBody, defaultSecret);
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: { 'x-webhook-signature': `sha256=${validHex}` },
        rawBody: Buffer.alloc(0),
      };

      expect(() => middleware.use(req, {} as any, jest.fn())).toThrow(
        ForbiddenException,
      );
    });
  });
});
