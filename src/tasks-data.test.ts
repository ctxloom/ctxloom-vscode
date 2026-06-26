import { describe, expect, it } from "vitest";
import { parseTasks } from "./tasks-data.js";

// Captured verbatim from `taskloom list --all --json` against a real store,
// covering several statuses and a Deferred task carrying a trigger.
const REAL_JSON = JSON.stringify([
  {
    harp_id: "vital-cough",
    text: "Wire up the tasks tree view",
    status: "In Progress",
    checked: false,
    text_hash: "aaaa",
    origin_session: "fatal-mere-carat",
  },
  {
    harp_id: "moot-jazz",
    text: "Parse list output tolerantly",
    status: "Done",
    checked: true,
    text_hash: "bbbb",
  },
  {
    harp_id: "shiny-fifth",
    text: "Investigate deferred trigger mechanism",
    status: "Deferred",
    checked: false,
    trigger: "when the parser is done",
  },
  { harp_id: "fresh-quote", text: "Ship the integration", status: "To Do", checked: false },
]);

describe("parseTasks", () => {
  it("maps harp_id→harpId and carries status/text/trigger", () => {
    expect(parseTasks(REAL_JSON)).toEqual([
      { harpId: "vital-cough", status: "In Progress", text: "Wire up the tasks tree view" },
      { harpId: "moot-jazz", status: "Done", text: "Parse list output tolerantly" },
      {
        harpId: "shiny-fifth",
        status: "Deferred",
        text: "Investigate deferred trigger mechanism",
        trigger: "when the parser is done",
      },
      { harpId: "fresh-quote", status: "To Do", text: "Ship the integration" },
    ]);
  });

  it("returns an empty array for an empty store", () => {
    expect(parseTasks("[]")).toEqual([]);
  });

  it("skips entries without a string harp_id", () => {
    const json = JSON.stringify([
      { text: "no id" },
      { harp_id: 42 },
      { harp_id: "keep", status: "To Do", text: "ok" },
      null,
    ]);
    expect(parseTasks(json)).toEqual([
      { harpId: "keep", status: "To Do", text: "ok" },
    ]);
  });

  it("defaults missing status/text to empty strings", () => {
    expect(parseTasks(JSON.stringify([{ harp_id: "bare" }]))).toEqual([
      { harpId: "bare", status: "", text: "" },
    ]);
  });

  it("omits an empty trigger", () => {
    const tasks = parseTasks(JSON.stringify([{ harp_id: "h", status: "Deferred", text: "t", trigger: "" }]));
    expect(tasks[0]).toEqual({ harpId: "h", status: "Deferred", text: "t" });
  });

  it("throws on output that isn't a JSON array", () => {
    expect(() => parseTasks("{}")).toThrow();
    expect(() => parseTasks("not json")).toThrow();
  });
});
