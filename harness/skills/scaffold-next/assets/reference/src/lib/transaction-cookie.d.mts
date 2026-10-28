export declare const TRANSACTION_SECONDS: number;
export type TransactionBinding = { name: string; origin: string };
export type Transaction = { verifier: string; state: string; nonce: string; returnTo: string };
export declare class TransactionError extends Error {
  readonly reason: 'invalid_transaction' | 'expired_transaction';
  constructor(reason: 'invalid_transaction' | 'expired_transaction');
}
export declare function transactionKey(secret: string): Buffer;
export declare function sealPayload(key: Buffer, binding: TransactionBinding, payload: unknown): string;
export declare function sealTransaction(
  key: Buffer,
  binding: TransactionBinding,
  transaction: Transaction,
  now?: number,
): string;
export declare function openTransaction(
  key: Buffer,
  binding: TransactionBinding,
  value: string,
  now?: number,
): Transaction & { issuedAt: number };
