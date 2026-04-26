import { Pool } from "pg";

const MIN_DATABASE_URL_LENGTH = 20;
const POSTGRES_PROTOCOL_REGEX = /^postgres(ql)?:\/\/.+/i;

const validateDatabaseUrl = (value) => {
  if (typeof value !== "string") {
    throw new Error("DATABASE_URL must be a string.");
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length < MIN_DATABASE_URL_LENGTH) {
    throw new Error("DATABASE_URL is too short.");
  }

  if (!POSTGRES_PROTOCOL_REGEX.test(trimmedValue)) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
  }

  return trimmedValue;
};

let pool;

const getPool = () => {
  if (pool) {
    return pool;
  }

  const connectionString = validateDatabaseUrl(process.env.DATABASE_URL);
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
};

export const query = (text, params = []) => getPool().query(text, params);
export const getClient = () => getPool().connect();
