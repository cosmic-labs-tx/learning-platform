/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import invariant from "tiny-invariant";
import ws from "ws";

const singleton = <Value>(name: string, valueFactory: () => Value): Value => {
  const g = global as unknown as { __singletons: Record<string, unknown> };
  g.__singletons ??= {};
  g.__singletons[name] ??= valueFactory();
  return g.__singletons[name] as Value;
};

const db = singleton("prisma", getPrismaClient);

function getPrismaClient() {
  const { DATABASE_URL } = process.env;
  invariant(typeof DATABASE_URL === "string", "DATABASE_URL env var not set");

  neonConfig.webSocketConstructor = ws;
  const connectionString = `${process.env.DATABASE_URL}`;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  const client = new PrismaClient({ adapter });
  // connect eagerly
  void client.$connect();

  return client;
}

export { db };
