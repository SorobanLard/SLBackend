import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Keypair } from '@stellar/stellar-sdk';
import { PayoutFrequency } from '@prisma/client';
import { CreatePayoutScheduleDto } from '../../modules/payouts/dto/create-payout-schedule.dto';
import {
  IsStellarAddress,
  isValidStellarAddress,
} from './stellar-address.validator';

class SampleStellarDto {
  @IsStellarAddress()
  address!: string;
}

describe('IsStellarAddress validator', () => {
  const validPublicKey = Keypair.random().publicKey();

  it('accepts a valid Stellar Ed25519 public key (G...)', () => {
    expect(isValidStellarAddress(validPublicKey)).toBe(true);

    const dto = plainToInstance(SampleStellarDto, { address: validPublicKey });
    const errors = validateSync(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects truncated Stellar addresses', () => {
    const truncated = validPublicKey.slice(0, 40);
    expect(isValidStellarAddress(truncated)).toBe(false);

    const dto = plainToInstance(CreatePayoutScheduleDto, {
      frequency: PayoutFrequency.MONTHLY,
      minimumThreshold: 10,
      stellarAddress: truncated,
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'stellarAddress')).toBe(true);
  });

  it('rejects malformed addresses and addresses with invalid StrKey checksums', () => {
    const badChecksum =
      validPublicKey.slice(0, -1) + (validPublicKey.endsWith('A') ? 'B' : 'A');
    expect(isValidStellarAddress(badChecksum)).toBe(false);
    expect(isValidStellarAddress('not-a-stellar-address')).toBe(false);
    expect(isValidStellarAddress('S' + validPublicKey.slice(1))).toBe(false);

    const dto = plainToInstance(CreatePayoutScheduleDto, {
      frequency: PayoutFrequency.MONTHLY,
      minimumThreshold: 10,
      stellarAddress: badChecksum,
    });
    const errors = validateSync(dto);
    expect(errors.some((e) => e.property === 'stellarAddress')).toBe(true);
  });
});
