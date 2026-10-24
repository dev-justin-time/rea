import { describe, expect, it } from "vitest";

import {
  parseGhidraFunctionInput,
  parseGhidraFunctionResult,
} from "./GhidraFunctionValues.js";

const value = {
  outcome: "returned",
  function_name: "hash_name",
  entry_address: "0x401000",
  steps: 42,
  max_steps: 500,
  final_pc: "0x7ffe0000",
  fault: null,
  registers: [
    { name: "EAX", value_hex: "0x7c0dfcaa" },
    { name: "EIP", value_hex: "0x7ffe0000" },
  ],
  memory: [
    {
      address: "0x7ffe1000",
      length: 4,
      hex: "436f6465",
      error: null,
    },
  ],
  omitted_registers: 0,
} as const;

describe("Ghidra emulation input", () => {
  it("supplies every bridge key from caller defaults", () => {
    const parsed = parseGhidraFunctionInput("emulate_native_function", {
      procedure: "hash_name",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({
      document: null,
      procedure: "hash_name",
      registers: {},
      memory: [],
      read_memory: [],
      max_steps: 10_000,
      return_registers: [],
    });
  });

  it("preserves explicit seeds and reads", () => {
    const parsed = parseGhidraFunctionInput("emulate_native_function", {
      procedure: "0x401000",
      registers: { ECX: "0x7ffe1000" },
      memory: [{ address: "0x7ffe1000", text: "CreateProcessW" }],
      read_memory: [{ address: "0x401100", length: 16 }],
      max_steps: 5,
      return_registers: ["EAX"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      registers: { ECX: "0x7ffe1000" },
      memory: [{ address: "0x7ffe1000", text: "CreateProcessW" }],
      read_memory: [{ address: "0x401100", length: 16 }],
      max_steps: 5,
      return_registers: ["EAX"],
    });
  });

  it.each([
    { max_steps: 0 },
    { max_steps: 100_001 },
    { registers: { ECX: "not-hex" } },
    { memory: [{ address: "0x1000", hex: "00", text: "x" }] },
    { read_memory: [{ address: "0x1000", length: 0 }] },
    { unexpected: true },
  ])("rejects invalid input %j", (override) => {
    expect(
      parseGhidraFunctionInput("emulate_native_function", {
        procedure: "main",
        ...override,
      }).ok,
    ).toBe(false);
  });
});

describe("Ghidra emulation result", () => {
  const parse = (wire: unknown) =>
    parseGhidraFunctionResult("emulate_native_function", wire as never);

  it("accepts a returned observation with its limitations", () => {
    const parsed = parse({ value, limitations: ["isolated emulator state"] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.value).toEqual(value);
    expect(parsed.value.limitations).toEqual(["isolated emulator state"]);
  });

  it.each([
    [{ ...value, fault: "unmapped write" }, ["limitation"]],
    [{ ...value, outcome: "fault", fault: null }, ["limitation"]],
    [{ ...value, final_pc: "0X7FFE0000" }, ["limitation"]],
    [
      { ...value, registers: [{ name: "EAX", value_hex: "1234" }] },
      ["limitation"],
    ],
    [{ ...value, max_steps: 1, steps: 2 }, ["limitation"]],
  ])("rejects an inconsistent observation %#", (invalid, limitations) => {
    expect(parse({ value: invalid, limitations }).ok).toBe(false);
  });

  it("requires the bridge limitation envelope", () => {
    expect(parse(value).ok).toBe(false);
  });
});
