import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

const USDC_SCALE = 10_000_000;

export interface IsUsdcAmountOptions extends ValidationOptions {
  allowZero?: boolean;
  condition?: (object: object) => boolean;
}

export function isValidUsdcAmount(value: unknown, allowZero = false): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (allowZero && value === 0) return true;
  return value > 0 && Number.isSafeInteger(value * USDC_SCALE);
}

export function IsUsdcAmount(options: IsUsdcAmountOptions = {}) {
  const { allowZero = false, condition, ...validationOptions } = options;

  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isUsdcAmount',
      target: object.constructor,
      propertyName,
      constraints: [allowZero, condition],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [zeroAllowed, appliesTo] = args.constraints as [
            boolean,
            IsUsdcAmountOptions['condition'],
          ];
          return (appliesTo && !appliesTo(args.object)) || isValidUsdcAmount(value, zeroAllowed);
        },
        defaultMessage() {
          return 'Amount must be positive, have at most 7 decimal places, and fit within the supported USDC range';
        },
      },
    });
  };
}

export function IsFutureDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() > Date.now();
        },
        defaultMessage() {
          return 'Date must be in the future';
        },
      },
    });
  };
}

export function IsPercentageAtMost(
  max: number,
  condition: (object: object) => boolean,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPercentageAtMost',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          return !condition(args.object)
            || (typeof value === 'number' && Number.isFinite(value) && value <= args.constraints[0]);
        },
        defaultMessage(args: ValidationArguments) {
          return `Percentage discount cannot exceed ${args.constraints[0]}`;
        },
      },
    });
  };
}
