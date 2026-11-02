import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import "dotenv/config";

// Singleton Prisma Client instance for the Telegram Bot (Bun & Node compatible)
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const createPrismaClient = () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: [
      {
        emit: "event",
        level: "query",
      },
      {
        emit: "stdout",
        level: "warn",
      },
      {
        emit: "stdout",
        level: "error",
      },
    ],
  });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

prisma.$on("query", (e) => {
  console.log("\n========== PRISMA QUERY ==========");
  console.log("Duration:", e.duration, "ms");
  console.log("Query:", e.query);
  console.log("Parameters:", e.params);
  console.log("==================================\n");
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Export as db for backwards-compatibility with existing bot imports
export const db = prisma;

export default prisma;
