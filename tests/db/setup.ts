import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DB tests need DATABASE_URL in .env.local");
}
