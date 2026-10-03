import { getDb, type DbTx } from "@/lib/db/client";

class Rollback extends Error {}

/** Runs `fn` in a transaction that is always rolled back. */
export async function inRollback(fn: (tx: DbTx) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}
