import { z } from "zod";

import { nativeAddressObservationSchema } from "./nativeAddress.js";

const hexadecimalValue = z.string().regex(/^0x[0-9a-f]+$/u);

/** One explicit register value supplied before emulation starts. */
export const nativeEmulationRegisterInputSchema = z
  .record(z.string().min(1), z.string().regex(/^0x[0-9a-fA-F]{1,32}$/u))
  .describe("Register name to 0x-prefixed hexadecimal value.");

/** One memory region written into the isolated emulator state. */
export const nativeEmulationMemoryInputSchema = z
  .strictObject({
    address: nativeAddressObservationSchema,
    hex: z
      .string()
      .regex(/^(?:[0-9a-fA-F]{2})*$/u)
      .optional(),
    text: z.string().min(1).optional(),
  })
  .refine(
    (value) => (value.hex === undefined) !== (value.text === undefined),
    "Supply exactly one of hex or text",
  );

/** One region read back from the emulator state after it stops. */
export const nativeEmulationMemoryReadInputSchema = z.strictObject({
  address: nativeAddressObservationSchema,
  length: z.int().min(1).max(65_536),
});

/** Caller options for one bounded, isolated function emulation. */
export const nativeEmulationInputSchema = z.strictObject({
  document: z.string().min(1).nullable().default(null),
  procedure: z.string().min(1),
  registers: nativeEmulationRegisterInputSchema.default({}),
  memory: z.array(nativeEmulationMemoryInputSchema).max(1_024).default([]),
  read_memory: z
    .array(nativeEmulationMemoryReadInputSchema)
    .max(1_024)
    .default([]),
  max_steps: z.int().min(1).max(100_000).default(10_000),
  return_registers: z.array(z.string().min(1)).max(64).default([]),
});

/** One register value observed when emulation stops. */
export const nativeEmulationRegisterSchema = z.strictObject({
  name: z.string().min(1),
  value_hex: hexadecimalValue,
});

/** One emulator memory read after execution stops. */
export const nativeEmulationMemoryReadSchema = z.strictObject({
  address: nativeAddressObservationSchema,
  length: z.int().min(1),
  hex: z
    .string()
    .regex(/^(?:[0-9a-f]{2})*$/u)
    .nullable(),
  error: z.string().min(1).nullable(),
});

/**
 * Bounded emulator observation. `returned` means execution reached the
 * synthetic sentinel return address; it does not establish correct calling
 * convention, OS behavior, or equivalence with the target process.
 */
export const nativeEmulationSchema = z
  .strictObject({
    outcome: z.enum(["returned", "step_limit", "fault"]),
    function_name: z.string().min(1),
    entry_address: nativeAddressObservationSchema,
    steps: z.int().nonnegative(),
    max_steps: z.int().positive(),
    final_pc: nativeAddressObservationSchema.nullable(),
    fault: z.string().min(1).nullable(),
    registers: z.array(nativeEmulationRegisterSchema),
    memory: z.array(nativeEmulationMemoryReadSchema),
    omitted_registers: z.int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.steps > value.max_steps)
      context.addIssue({
        code: "custom",
        message: "Emulation steps exceed the requested maximum",
      });
    if ((value.outcome === "fault") !== (value.fault !== null))
      context.addIssue({
        code: "custom",
        message: "Emulation fault text must accompany exactly a fault outcome",
      });
  });
