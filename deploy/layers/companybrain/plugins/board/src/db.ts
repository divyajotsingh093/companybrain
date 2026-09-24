import pg from "pg";

export type Param = string | number | null;

export interface Query {
  query<T>(text: string, params?: Param[]): Promise<{ rows: T[]; count: number }>;
}

export interface Database extends Query {
  transaction<T>(run: (tx: Query) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const INT8_OID = 20;

const logConnectionError = (err: Error) => console.error(`board database connection error: ${err.name}`);

export function createPool(connectionString: string, connectionTimeoutMillis = 5_000): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis,
    types: {
      getTypeParser: (oid: number, format?: string) =>
        oid === INT8_OID ? (value: string) => Number(value) : pg.types.getTypeParser(oid, format as "text"),
    } as pg.CustomTypesConfig,
  });
  pool.on("error", logConnectionError);
  return pool;
}

export function postgres(pool: pg.Pool): Database {
  const run = async <T>(client: pg.Pool | pg.PoolClient, text: string, params: Param[] = []) => {
    const result = await client.query(text, params);
    return { rows: result.rows as T[], count: result.rowCount ?? 0 };
  };
  return {
    query: (text, params) => run(pool, text, params),
    async transaction(body) {
      const client = await pool.connect();
      client.on("error", logConnectionError);
      let broken = false;
      try {
        await client.query("BEGIN");
        const result = await body({ query: (text, params) => run(client, text, params) });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
          broken = true;
        });
        throw err;
      } finally {
        client.off("error", logConnectionError);
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
