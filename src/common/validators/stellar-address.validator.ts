import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

export interface IsStellarAddressOptions extends ValidationOptions {
  /** Allow Soroban contract addresses (C... StrKey) in addition to Ed25519 public keys (G...). */
  allowContract?: boolean;
  /** Require a Soroban contract address (C... StrKey) only. */
  contractOnly?: boolean;
}

export function isValidStellarAddress(
  value: unknown,
  options: Pick<IsStellarAddressOptions, 'allowContract' | 'contractOnly'> = {},
): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  if (options.contractOnly) {
    return StrKey.isValidContract(value);
  }

  if (StrKey.isValidEd25519PublicKey(value)) {
    return true;
  }

  if (options.allowContract && StrKey.isValidContract(value)) {
    return true;
  }

  return false;
}

export function IsStellarAddress(options: IsStellarAddressOptions = {}) {
  const {
    allowContract = false,
    contractOnly = false,
    ...validationOptions
  } = options;

  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName,
      constraints: [{ allowContract, contractOnly }],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [constraintOptions] = args.constraints as [
            Pick<IsStellarAddressOptions, 'allowContract' | 'contractOnly'>,
          ];
          return isValidStellarAddress(value, constraintOptions);
        },
        defaultMessage(args: ValidationArguments) {
          const [constraintOptions] = args.constraints as [
            Pick<IsStellarAddressOptions, 'allowContract' | 'contractOnly'>,
          ];
          if (constraintOptions?.contractOnly) {
            return `${args.property} must be a valid Soroban contract address (starts with C, 56 chars, valid StrKey checksum)`;
          }
          if (constraintOptions?.allowContract) {
            return `${args.property} must be a valid Stellar public key (G...) or Soroban contract address (C...)`;
          }
          return `${args.property} must be a valid Stellar Ed25519 public key (starts with G, 56 chars, valid StrKey checksum)`;
        },
      },
    });
  };
}
