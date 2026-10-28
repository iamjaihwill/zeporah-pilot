import { describe, expect, it } from "vitest";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/server/db/schema";
import { classOf, RECORD_CLASSES, TABLE_CLASSES } from "@/domain/record-classes";

const tables = Object.values(schema)
  .filter((v) => is(v, PgTable))
  .map((t) => getTableName(t as PgTable))
  .sort();

describe("record classes (proposal for D-05)", () => {
  it("classifies every table, and no table that doesn't exist", () => {
    expect(Object.keys(TABLE_CLASSES).sort()).toEqual(tables);
  });

  it("uses only defined classes, and refuses an unknown table", () => {
    for (const e of Object.values(TABLE_CLASSES)) expect(RECORD_CLASSES).toContain(e.class);
    expect(() => classOf("not_a_table")).toThrow(/No record class/);
  });
});
