import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoFile } from "../../lib/source-drift";
import { REDIS } from "./viz";

describe("Redis settings copied from docker-compose.yaml", () => {
  const compose = readFileSync(repoFile("docker-compose.yaml"), "utf8");
  const command = (service: string) =>
    compose
      .slice(compose.indexOf(`  ${service}:`))
      .match(/command: (redis-server[^\n]*)/)![1]!;

  it("runs the cache with eviction and no persistence", () => {
    const cache = command(REDIS.cache.service);
    expect(cache).toContain(`--maxmemory ${REDIS.cache.maxmemory}`);
    expect(cache).toContain(`--maxmemory-policy ${REDIS.cache.policy}`);
    expect(cache).not.toContain("--appendonly yes");
  });

  it("runs the durable instance with an append-only file and no eviction", () => {
    const durable = command(REDIS.durable.service);
    expect(durable).toContain("--appendonly yes");
    expect(durable).toContain(`--appendfsync ${REDIS.durable.fsync}`);
    expect(durable).toContain(`--maxmemory ${REDIS.durable.maxmemory}`);
    expect(durable).toContain(`--maxmemory-policy ${REDIS.durable.policy}`);
  });
});
