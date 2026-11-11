import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../database/migrations/20261107_02_add_data_integrity_constraints.sql",
  import.meta.url,
);
const preflightUrl = new URL(
  "../../database/migrations/20261107_02_data_integrity_preflight.sql",
  import.meta.url,
);
const rollbackUrl = new URL(
  "../../database/migrations/20261107_02_add_data_integrity_constraints.rollback.sql",
  import.meta.url,
);
const schemaUrl = new URL("../../database/schema.sql", import.meta.url);

test("integrity preflight is read-only and covers every upgrade constraint", async () => {
  const [migration, preflight] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(preflightUrl, "utf8"),
  ]);
  const constraints = [
    ...migration.matchAll(
      /-- ALTER TABLE .*? ADD CONSTRAINT\s+(chk_[a-z0-9_]+)/gi,
    ),
  ].map((match) => match[1]);

  assert.equal(constraints.length, 18);
  for (const constraint of constraints) {
    assert.ok(
      preflight.includes(constraint),
      `Preflight is missing ${constraint}`,
    );
  }
  assert.equal(
    /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b/im.test(
      preflight,
    ),
    false,
  );
  assert.match(migration, /20261107_02_data_integrity_preflight\.sql/);
  assert.match(migration, /commit independently/);
});

test("migration status query distinguishes all outcomes and prevents batch duplicate DDL", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const [query = ""] = migration.split(
    /-- Apply one statement only when its status is MISSING\./,
  );
  assert.match(query, /'MISSING'/);
  assert.match(query, /'ALREADY_APPLIED'/);
  assert.match(query, /'NAME_CONFLICT'/);
  assert.match(query, /'DEFINITION_MISMATCH'/);
  assert.match(query, /actual_expression/);
  assert.match(query, /information_schema\.table_constraints/);
  assert.match(query, /information_schema\.check_constraints/);
  assert.equal(/^\s*ALTER TABLE\b/im.test(migration), false);

  const expectedNames = [...query.matchAll(/'((?:chk_)[a-z0-9_]+)'/gi)].map(
    (match) => match[1],
  );
  assert.equal(new Set(expectedNames).size, 18);

  const templateNames = [
    ...migration.matchAll(
      /^-- ALTER TABLE .*? ADD CONSTRAINT\s+(chk_[a-z0-9_]+)/gm,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(new Set(templateNames), new Set(expectedNames));

  const allStatuses = new Map(expectedNames.map((name) => [name, "MISSING"]));
  const partialApplied = expectedNames.slice(0, 7);
  for (const name of partialApplied) allStatuses.set(name, "ALREADY_APPLIED");
  assert.equal(
    [...allStatuses.values()].filter((status) => status === "MISSING").length,
    11,
  );
  assert.equal(
    [...allStatuses.values()].filter((status) => status === "ALREADY_APPLIED")
      .length,
    7,
  );
  assert.equal(
    templateNames.filter((name) => allStatuses.get(name) === "MISSING").length,
    11,
  );
  assert.equal(
    templateNames.filter((name) => allStatuses.get(name) === "ALREADY_APPLIED")
      .length,
    7,
  );
});

test("rollback requires the operator to identify applied constraints before dropping them", async () => {
  const rollback = await readFile(rollbackUrl, "utf8");
  assert.match(rollback, /Manual rollback procedure only/);
  assert.match(
    rollback,
    /only for each constraint reported as\s+--\s+APPLIED/i,
  );
  assert.equal(/^\s*ALTER TABLE\b/im.test(rollback), false);
  assert.equal((rollback.match(/^\s*-- ALTER TABLE\b/gm) || []).length, 18);
});

test("fresh schema and upgrade migration define the same integrity constraints", async () => {
  const [migration, schema] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(schemaUrl, "utf8"),
  ]);
  const migrationConstraints = [
    ...migration.matchAll(
      /^-- ALTER TABLE .*? ADD CONSTRAINT\s+(chk_[a-z0-9_]+)/gm,
    ),
  ].map((match) => match[1]);
  const schemaConstraints = [
    ...schema.matchAll(/CONSTRAINT\s+(chk_[a-z0-9_]+)\s+CHECK/gi),
  ].map((match) => match[1]);

  assert.deepEqual(new Set(schemaConstraints), new Set(migrationConstraints));
});
