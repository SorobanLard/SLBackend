import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Networks,
  SorobanRpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Keypair,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * StellarService
 *
 * Provides:
 *  - Soroban RPC client for querying the Stellar network
 *  - Contract event fetching (EventsService poller)
 *  - Read-only contract simulation (is_enrolled, verify_certificate, etc.)
 *  - USDC / stroops conversion helpers
 *
 * This service does NOT submit write transactions — all writes are signed
 * by the user's Freighter wallet in the frontend. The admin wallet address
 * (for course approval, mark_completed, issue_certificate) is managed
 * by a separate secure signing service in production.
 */
@Injectable()
export class StellarService implements OnModuleInit {
  private readonly logger = new Logger(StellarService.name);

  private rpcClient: SorobanRpc.Server;
  private networkPassphrase: string;
  private contractId: string;

  /** Number of attempts for RPC calls before giving up (retry-with-backoff). */
  private readonly maxAttempts = 3;
  /** Base delay (ms) for exponential backoff between retries. */
  private readonly baseRetryDelayMs = 500;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const rpcUrl     = this.config.get<string>('STELLAR_RPC_URL');
    const networkName = this.config.get<string>('STELLAR_NETWORK', 'testnet');

    this.rpcClient = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    this.contractId = this.config.get<string>('SOROBANLARD_CONTRACT_ID');
    this.networkPassphrase =
      networkName === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.logger.log(`Stellar connected to ${networkName} (${rpcUrl})`);
    this.logger.log(`SorobanLard contract: ${this.contractId}`);
  }

  // ----------------------------------------------------------
  // RPC ACCESS
  // ----------------------------------------------------------

  getClient(): SorobanRpc.Server      { return this.rpcClient; }
  getNetworkPassphrase(): string       { return this.networkPassphrase; }
  getContractId(): string              { return this.contractId; }

  /**
   * Execute an RPC operation with retry-with-backoff.
   *
   * Retries up to `maxAttempts` times with exponential backoff. On exhausted
   * retries the last error is rethrown so callers (e.g. certificate issuance)
   * can persist a PENDING/FAILED state instead of failing silently.
   */
  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < this.maxAttempts) {
          const delay = this.baseRetryDelayMs * 2 ** (attempt - 1);
          this.logger.warn(
            `${label} failed (attempt ${attempt}/${this.maxAttempts}), retrying in ${delay}ms: ${error?.message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(
            `${label} failed after ${this.maxAttempts} attempts: ${error?.message}`,
          );
        }
      }
    }
    throw lastError;
  }

  async getLatestLedger(): Promise<number> {
    const info = await this.withRetry('getLatestLedger', () =>
      this.rpcClient.getLatestLedger(),
    );
    return info.sequence;
  }

  // ----------------------------------------------------------
  // EVENT FETCHING
  // ----------------------------------------------------------

  /**
   * Fetch SorobanLard contract events from a given ledger.
   * Called every 5 seconds by EventsService.
   */
  async fetchContractEvents(
    startLedger: number,
  ): Promise<SorobanRpc.Api.EventResponse[]> {
    try {
      const result = await this.withRetry('fetchContractEvents', () =>
        this.rpcClient.getEvents({
          startLedger,
          filters: [
            {
              type: 'contract',
              contractIds: [this.contractId],
            },
          ],
          limit: 100,
        }),
      );
      return result.events ?? [];
    } catch (error) {
      this.logger.error(`Failed to fetch events from ledger ${startLedger}`, error.message);
      return [];
    }
  }

  // ----------------------------------------------------------
  // READ-ONLY CONTRACT CALLS
  // ----------------------------------------------------------

  /**
   * Simulate a read-only contract call — no gas, no signing.
   * Used to check on-chain state (is_enrolled, verify_certificate).
   *
   * Retries with backoff on RPC timeouts/downtime; rethrows on exhausted
   * retries so callers can react (e.g. mark certificate issuance FAILED).
   */
  async simulateCall(method: string, args: xdr.ScVal[]): Promise<any> {
    try {
      const contract    = new Contract(this.contractId);
      const dummyKeypair = Keypair.random();
      const dummyAccount = {
        accountId: () => dummyKeypair.publicKey(),
        sequenceNumber: () => '0',
        incrementSequenceNumber: () => {},
      } as any;

      const tx = new TransactionBuilder(dummyAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const simulation = await this.withRetry(`simulateCall(${method})`, () =>
        this.rpcClient.simulateTransaction(tx),
      );
      if (SorobanRpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation error: ${simulation.error}`);
      }
      if (SorobanRpc.Api.isSimulationSuccess(simulation) && simulation.result) {
        return scValToNative(simulation.result.retval);
      }
      return null;
    } catch (error) {
      this.logger.error(`simulateCall(${method}) failed`, error.message);
      throw error;
    }
  }

  /** Check on-chain whether a student is enrolled in a course */
  async isEnrolledOnChain(studentAddress: string, courseId: string): Promise<boolean> {
    try {
      const { nativeToScVal, Address } = await import('@stellar/stellar-sdk');
      const result = await this.simulateCall('is_enrolled', [
        new Address(studentAddress).toScVal(),
        nativeToScVal(courseId, { type: 'string' }),
      ]);
      return Boolean(result);
    } catch { return false; }
  }

  /** Verify a certificate on-chain */
  async verifyCertificateOnChain(certificateId: string): Promise<boolean> {
    try {
      const { nativeToScVal } = await import('@stellar/stellar-sdk');
      const result = await this.simulateCall('verify_certificate', [
        nativeToScVal(certificateId, { type: 'string' }),
      ]);
      return Boolean(result);
    } catch { return false; }
  }

  /**
   * Look up a submitted transaction by hash and report whether it succeeded.
   * Used to confirm an admin-submitted refund (or other) transaction actually
   * landed on-chain before the backend marks it as processed.
   */
  async getTransactionStatus(
    txHash: string,
  ): Promise<{ status: string; successful: boolean } | null> {
    try {
      const result = await this.withRetry(`getTransactionStatus(${txHash})`, () =>
        this.rpcClient.getTransaction(txHash),
      );
      return {
        status: result.status,
        successful: result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      };
    } catch (error) {
      this.logger.error(`getTransactionStatus(${txHash}) failed`, error.message);
      return null;
    }
  }

  // ----------------------------------------------------------
  // USDC UTILITIES
  // ----------------------------------------------------------

  /** Convert stroops (i128 as string/bigint) to human-readable USDC */
  stroopsToUsdc(stroops: string | bigint, decimals = 2): string {
    const v = BigInt(stroops);
    const whole    = v / 10_000_000n;
    const fraction = (v % 10_000_000n).toString().padStart(7, '0');
    return parseFloat(`${whole}.${fraction}`).toFixed(decimals);
  }

  /** Convert human-readable USDC to stroops bigint */
  usdcToStroops(usdc: string | number): bigint {
    const [whole, fraction = ''] = String(usdc).split('.');
    const padded = fraction.padEnd(7, '0').slice(0, 7);
    return BigInt(whole) * 10_000_000n + BigInt(padded);
  }
}
