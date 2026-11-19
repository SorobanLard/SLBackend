import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

export interface IsStellarAddressOptions extends ValidationOptions {
  allowContract?: boolean;
}

export function isValidStellarAddress(
  value: unknown,
  allowContract = false,
): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (StrKey.isValidEd25519PublicKey(trimmed)) return true;
  if (allowContract && StrKey.isValidContract(trimmed)) return true;
  return false;
}

export function IsStellarAddress(options: IsStellarAddressOptions = {}) {
  const { allowContract = false, ...validationOptions } = options;

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
          const [contractAllowed] = args.constraints as [boolean];
          return contractAllowed
            ? `${args.property} must be a valid Stellar public key (G...) or contract address (C...)`
            : `${args.property} must be a valid Stellar public key (G...) with a valid StrKey checksum`;
        },
      },
    });
  };
}
