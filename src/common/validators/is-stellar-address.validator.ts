import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

export interface IsStellarAddressOptions extends ValidationOptions {
  /** Allow Soroban contract addresses (`C...`) in addition to Ed25519 account keys (`G...`). Defaults to true. */
  allowContract?: boolean;
}

/**
 * Validates that a value is a well-formed Stellar Ed25519 public key (`G...`)
 * or Soroban contract address (`C...`) with a valid CRC16-XModem StrKey checksum.
 */
export function isValidStellarAddress(
  value: unknown,
  allowContract = true,
): value is string {
  if (typeof value !== 'string' || value.length !== 56) {
    return false;
  }

  if (StrKey.isValidEd25519PublicKey(value)) {
    return true;
  }

  if (allowContract && StrKey.isValidContract(value)) {
    return true;
  }

  return false;
}

export function IsStellarAddress(options: IsStellarAddressOptions = {}) {
  const { allowContract = true, ...validationOptions } = options;

  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName,
      constraints: [allowContract],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [contractAllowed] = args.constraints as [boolean];
          return isValidStellarAddress(value, contractAllowed);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid Stellar address (G... or C... with valid StrKey checksum)`;
        },
      },
    });
  };
}
