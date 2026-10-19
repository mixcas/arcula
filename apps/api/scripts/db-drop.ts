// Drop the application schema over DATABASE_URL — db:reset's destructive
// half, for a database this machine does not run. scripts/reset-dev.sh (the
// dev reset) is the caller.
import postgres from "postgres";
import { DROP_APP_SCHEMAS_SQL } from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  await sql.unsafe(DROP_APP_SCHEMAS_SQL);
  console.log("schema dropped: public and drizzle (public recreated)");
} finally {
  await sql.end({ timeout: 5 });
}
