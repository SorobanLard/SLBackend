import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';
import {
  safeCompare,
  WebhookSignatureMiddleware,
} from './webhook-signature.middleware';

describe('WebhookSignatureMiddleware', () => {
  const defaultSecret = 'test-webhook-secret';
  const rawBody = Buffer.from(JSON.stringify({ event: 'payment.succeeded', id: 'evt_1' }));
  const validHex = crypto
    .createHmac('sha256', defaultSecret)
    .update(rawBody)
    .digest('hex');

  const buildMiddleware = (secrets: Record<string, string | undefined> = { WEBHOOK_SECRET: defaultSecret }) => {
    const config = {
      get: jest.fn((key: string) => secrets[key]),
    } as unknown as ConfigService;
    const reflector = {} as Reflector;
    return new WebhookSignatureMiddleware(config, reflector);
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('safeCompare()', () => {
    it('uses crypto.timingSafeEqual on buffers of equal byte length for valid signatures', () => {
      const spy = jest.spyOn(crypto, 'timingSafeEqual');

      expect(safeCompare(validHex, validHex)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      const [bufA, bufB] = spy.mock.calls[0];
      expect(Buffer.isBuffer(bufA)).toBe(true);
      expect(Buffer.isBuffer(bufB)).toBe(true);
      expect(bufA.byteLength).toBe(32);
      expect(bufB.byteLength).toBe(32);
    });

    it('invokes crypto.timingSafeEqual and returns false for an invalid signature of the exact same byte length', () => {
      const spy = jest.spyOn(crypto, 'timingSafeEqual');
      // Flip the last hex nibble while keeping the exact 64-char / 32-byte length
      const flippedNibble = validHex.endsWith('0') ? '1' : '0';
      const invalidSameLengthHex = validHex.slice(0, -1) + flippedNibble;

      expect(invalidSameLengthHex.length).toBe(validHex.length);
      expect(safeCompare(validHex, invalidSameLengthHex)).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('handles different-length and non-hex signatures safely without throwing', () => {
      const spy = jest.spyOn(crypto, 'timingSafeEqual');

      expect(safeCompare(validHex, validHex.slice(0, 10))).toBe(false);
      expect(safeCompare(validHex, `${validHex}00`)).toBe(false);
      expect(safeCompare(validHex, 'z'.repeat(validHex.length))).toBe(false);
      expect(safeCompare('', '')).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('middleware.use()', () => {
    it('calls next() when X-Webhook-Signature has a valid sha256=<hex> signature', () => {
      const middleware = buildMiddleware();
      const next = jest.fn();
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: { 'x-webhook-signature': `sha256=${validHex}` },
        rawBody,
      };

      middleware.use(req, {} as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid signature of the exact same length using timingSafeEqual', () => {
      const middleware = buildMiddleware();
      const spy = jest.spyOn(crypto, 'timingSafeEqual');
      const next = jest.fn();
      const invalidSameLength =
        (validHex[0] === 'a' ? 'b' : 'a') + validHex.slice(1);

      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: { 'x-webhook-signature': `sha256=${invalidSameLength}` },
        rawBody,
      };

      expect(() => middleware.use(req, {} as any, next)).toThrow(ForbiddenException);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a truncated/different-length signature with ForbiddenException', () => {
      const middleware = buildMiddleware();
      const next = jest.fn();
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: { 'x-webhook-signature': 'sha256=deadbeef' },
        rawBody,
      };

      expect(() => middleware.use(req, {} as any, next)).toThrow(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects requests without a signature header with UnauthorizedException', () => {
      const middleware = buildMiddleware();
      const next = jest.fn();
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/generic',
        headers: {},
        rawBody,
      };

      expect(() => middleware.use(req, {} as any, next)).toThrow(UnauthorizedException);
      expect(next).not.toHaveBeenCalled();
    });

    it('supports Stripe v1=<hex> signature header and provider-specific secret', () => {
      const stripeSecret = 'whsec_stripe_specific';
      const stripeHex = crypto
        .createHmac('sha256', stripeSecret)
        .update(rawBody)
        .digest('hex');
      const middleware = buildMiddleware({
        WEBHOOK_SECRET: defaultSecret,
        WEBHOOK_SECRET_STRIPE: stripeSecret,
      });
      const next = jest.fn();
      const req: any = {
        method: 'POST',
        originalUrl: '/api/v1/webhooks/stripe',
        headers: { 'stripe-signature': `t=1700000000,v1=${stripeHex}` },
        rawBody,
      };

      middleware.use(req, {} as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
