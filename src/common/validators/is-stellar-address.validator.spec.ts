import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { PayoutFrequency } from '@prisma/client';
import {
  IsStellarAddress,
  isValidStellarAddress,
} from './is-stellar-address.validator';
import { CreatePayoutScheduleDto } from '../../modules/payouts/dto/create-payout-schedule.dto';

class AccountOnlyAddressDto {
  @IsStellarAddress({ allowContract: false })
  address: string;
}

describe('IsStellarAddress validator', () => {
  const validPublicKey = Keypair.random().publicKey();
  const validContractAddress = StrKey.encodeContract(Buffer.alloc(32, 7));

  describe('isValidStellarAddress()', () => {
    it('accepts valid G... Ed25519 public keys and C... contract addresses', () => {
      expect(isValidStellarAddress(validPublicKey)).toBe(true);
      expect(isValidStellarAddress(validContractAddress)).toBe(true);
    });

    it('rejects C... contract addresses when allowContract is false', () => {
      expect(isValidStellarAddress(validPublicKey, false)).toBe(true);
      expect(isValidStellarAddress(validContractAddress, false)).toBe(false);
    });

    it('rejects truncated, malformed, or bad-checksum Stellar addresses', () => {
      const corruptedChecksum =
        validPublicKey.slice(0, -1) +
        (validPublicKey.endsWith('A') ? 'B' : 'A');

      expect(isValidStellarAddress(corruptedChecksum)).toBe(false);
      expect(isValidStellarAddress('GABC123')).toBe(false);
      expect(isValidStellarAddress('G'.repeat(56))).toBe(false);
      expect(isValidStellarAddress('')).toBe(false);
      expect(isValidStellarAddress(null)).toBe(false);
      expect(isValidStellarAddress(12345)).toBe(false);
    });
  });

  describe('CreatePayoutScheduleDto validation', () => {
    it('passes validation when stellarAddress is a valid Stellar address or omitted', async () => {
      const withValidKey = plainToInstance(CreatePayoutScheduleDto, {
        frequency: PayoutFrequency.MONTHLY,
        minimumThreshold: 10,
        stellarAddress: validPublicKey,
      });
      const withoutKey = plainToInstance(CreatePayoutScheduleDto, {
        frequency: PayoutFrequency.WEEKLY,
        minimumThreshold: 25,
      });

      expect(await validate(withValidKey)).toHaveLength(0);
      expect(await validate(withoutKey)).toHaveLength(0);
    });

    it('fails validation when stellarAddress is truncated or has an invalid StrKey checksum', async () => {
      const truncated = plainToInstance(CreatePayoutScheduleDto, {
        frequency: PayoutFrequency.MONTHLY,
        minimumThreshold: 10,
        stellarAddress: 'GXXXXXXX',
      });
      const badChecksum = plainToInstance(CreatePayoutScheduleDto, {
        frequency: PayoutFrequency.MONTHLY,
        minimumThreshold: 10,
        stellarAddress: 'G'.repeat(56),
      });

      const truncatedErrors = await validate(truncated);
      const checksumErrors = await validate(badChecksum);

      expect(truncatedErrors).toHaveLength(1);
      expect(truncatedErrors[0].property).toBe('stellarAddress');
      expect(truncatedErrors[0].constraints).toHaveProperty('isStellarAddress');

      expect(checksumErrors).toHaveLength(1);
      expect(checksumErrors[0].property).toBe('stellarAddress');
      expect(checksumErrors[0].constraints).toHaveProperty('isStellarAddress');
    });

    it('enforces allowContract: false on AccountOnlyAddressDto', async () => {
      const withContract = plainToInstance(AccountOnlyAddressDto, {
        address: validContractAddress,
      });
      const errors = await validate(withContract);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('isStellarAddress');
    });
  });
});
