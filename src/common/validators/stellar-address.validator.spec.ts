import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { PayoutFrequency } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IsStellarAddress,
  isValidStellarAddress,
} from './stellar-address.validator';
import { CreatePayoutScheduleDto } from '../../modules/payouts/dto/create-payout-schedule.dto';
import { UpdatePayoutScheduleDto } from '../../modules/payouts/dto/update-payout-schedule.dto';
import { LoginDto } from '../../modules/auth/auth.controller';
import { validateEnv } from '../../config/env.validation';

describe('StellarAddressValidator', () => {
  const validKeypair = Keypair.random();
  const validPublicKey = validKeypair.publicKey();
  const validSecretKey = validKeypair.secret();
  const validContractAddress = StrKey.encodeContract(Buffer.alloc(32, 7));

  const corruptChecksumAddress = (() => {
    const lastChar = validPublicKey[validPublicKey.length - 1];
    const replacement = lastChar === 'A' ? 'B' : 'A';
    return validPublicKey.slice(0, -1) + replacement;
  })();

  describe('isValidStellarAddress()', () => {
    it('accepts a valid Ed25519 Stellar public key (G...)', () => {
      expect(isValidStellarAddress(validPublicKey)).toBe(true);
    });

    it('rejects a G... address with a corrupted CRC16 checksum even when length is 56', () => {
      expect(corruptChecksumAddress).toHaveLength(56);
      expect(corruptChecksumAddress.startsWith('G')).toBe(true);
      expect(isValidStellarAddress(corruptChecksumAddress)).toBe(false);
    });

    it('rejects secret seeds (S...), wrong lengths, and non-strings', () => {
      expect(isValidStellarAddress(validSecretKey)).toBe(false);
      expect(isValidStellarAddress('GABC123')).toBe(false);
      expect(isValidStellarAddress('')).toBe(false);
      expect(isValidStellarAddress(null)).toBe(false);
      expect(isValidStellarAddress(undefined)).toBe(false);
      expect(isValidStellarAddress(12345)).toBe(false);
    });

    it('handles Soroban contract addresses (C...) according to allowContract and contractOnly flags', () => {
      expect(isValidStellarAddress(validContractAddress)).toBe(false);
      expect(
        isValidStellarAddress(validContractAddress, { allowContract: true }),
      ).toBe(true);
      expect(
        isValidStellarAddress(validPublicKey, { allowContract: true }),
      ).toBe(true);
      expect(
        isValidStellarAddress(validContractAddress, { contractOnly: true }),
      ).toBe(true);
      expect(
        isValidStellarAddress(validPublicKey, { contractOnly: true }),
      ).toBe(false);
    });
  });

  describe('DTO validation (@IsStellarAddress)', () => {
    it('validates CreatePayoutScheduleDto and UpdatePayoutScheduleDto stellarAddress', async () => {
      const validDto = plainToInstance(CreatePayoutScheduleDto, {
        frequency: PayoutFrequency.MONTHLY,
        minimumThreshold: 25,
        stellarAddress: validPublicKey,
      });
      expect(await validate(validDto)).toHaveLength(0);

      const invalidChecksumDto = plainToInstance(CreatePayoutScheduleDto, {
        frequency: PayoutFrequency.MONTHLY,
        minimumThreshold: 25,
        stellarAddress: corruptChecksumAddress,
      });
      const checksumErrors = await validate(invalidChecksumDto);
      expect(checksumErrors.length).toBeGreaterThan(0);
      expect(checksumErrors[0].property).toBe('stellarAddress');

      const invalidUpdateDto = plainToInstance(UpdatePayoutScheduleDto, {
        stellarAddress: validSecretKey,
      });
      const updateErrors = await validate(invalidUpdateDto);
      expect(updateErrors.length).toBeGreaterThan(0);
      expect(updateErrors[0].property).toBe('stellarAddress');
    });

    it('validates LoginDto stellarAddress before authentication', async () => {
      const validLogin = plainToInstance(LoginDto, {
        stellarAddress: validPublicKey,
        signedNonce: 'sorobanlard:nonce',
        signature: 'base64sig==',
      });
      expect(await validate(validLogin)).toHaveLength(0);

      const badLogin = plainToInstance(LoginDto, {
        stellarAddress: corruptChecksumAddress,
        signedNonce: 'sorobanlard:nonce',
        signature: 'base64sig==',
      });
      const loginErrors = await validate(badLogin);
      expect(loginErrors.length).toBeGreaterThan(0);
      expect(loginErrors[0].property).toBe('stellarAddress');
    });

    it('supports custom @IsStellarAddress({ allowContract: true }) decorator', async () => {
      class TokenConfigDto {
        @IsStellarAddress({ allowContract: true })
        tokenAddress: string;
      }

      const withContract = plainToInstance(TokenConfigDto, {
        tokenAddress: validContractAddress,
      });
      expect(await validate(withContract)).toHaveLength(0);

      const withBadContract = plainToInstance(TokenConfigDto, {
        tokenAddress: 'C' + 'A'.repeat(55),
      });
      expect((await validate(withBadContract)).length).toBeGreaterThan(0);
    });
  });

  describe('EnvironmentVariables validation (ADMIN_STELLAR_ADDRESS / TREASURY_STELLAR_ADDRESS)', () => {
    const baseEnv = {
      JWT_SECRET: 'super-secret-jwt-key-12345',
      JWT_REFRESH_SECRET: 'super-secret-refresh-key-12345',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
      STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      ADMIN_STELLAR_ADDRESS: validPublicKey,
      TREASURY_STELLAR_ADDRESS: Keypair.random().publicKey(),
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user',
      SMTP_PASS: 'pass',
      EMAIL_FROM: 'noreply@sorobanlard.com',
      CAPTCHA_SECRET_KEY: 'captcha-secret',
      WEBHOOK_SECRET: 'webhook-secret',
    };

    it('accepts valid Stellar public keys and contract addresses in validateEnv', () => {
      const validated = validateEnv({
        ...baseEnv,
        SOROBANLARD_CONTRACT_ID: validContractAddress,
        USDC_TOKEN_ADDRESS: validContractAddress,
      });
      expect(validated.ADMIN_STELLAR_ADDRESS).toBe(validPublicKey);
    });

    it('rejects ADMIN_STELLAR_ADDRESS or TREASURY_STELLAR_ADDRESS with invalid StrKey checksum', () => {
      expect(() =>
        validateEnv({
          ...baseEnv,
          ADMIN_STELLAR_ADDRESS: corruptChecksumAddress,
        }),
      ).toThrow(/ADMIN_STELLAR_ADDRESS/);

      expect(() =>
        validateEnv({
          ...baseEnv,
          TREASURY_STELLAR_ADDRESS: corruptChecksumAddress,
        }),
      ).toThrow(/TREASURY_STELLAR_ADDRESS/);
    });
  });
});
