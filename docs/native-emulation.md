# Native function emulation

`emulate_native_function` runs one analyzed procedure inside Ghidra's p-code
emulator with caller-supplied state. Use it when static code leaves a register or
memory value unresolved and you want a bounded, reproducible observation rather
than a runtime launch.

The emulator runs in REA's headless Ghidra provider. It is isolated from the
target process and from your host.

## Requirements

- A Ghidra provider session with the binary open.
- The procedure must be one Ghidra analyzed, selected by symbol or canonical
  address, optionally with the same `document` selector as other native tools.

Other providers report the operation as unsupported. The tool never starts the
target process and never needs a debugger.

## Input

```json
{
  "procedure": "check_license",
  "registers": { "rdi": "0x0", "rsi": "0x4000" },
  "memory": [{ "address": "0x4000", "text": "TRIAL" }],
  "read_memory": [{ "address": "0x6000", "length": 16 }],
  "max_steps": 10000,
  "return_registers": ["rax", "rflags"]
}
```

| Field              | Meaning                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `document`         | Optional provider document selector; defaults to the current document.                    |
| `procedure`        | Symbol or provider-normalized address of one analyzed procedure.                          |
| `registers`        | Register name to `0x`-prefixed hexadecimal value, seeded before the first instruction.    |
| `memory`           | Up to 1,024 regions of `{address, hex}` or `{address, text}`; exactly one of the two.     |
| `read_memory`      | Up to 1,024 regions `{address, length}` read after execution stops; `length` is 1-65,536. |
| `max_steps`        | Instruction budget, 1-100,000; default 10,000.                                            |
| `return_registers` | Up to 64 register names always reported, even when unchanged.                             |

Memory and register values are data, not code. Emulation starts at the selected
procedure's entry, not at an arbitrary address.

## Result

The result is Evidence, like other native tools, and contains:

- `outcome`: `returned`, `step_limit` or `fault`.
- `function_name` and `entry_address` for the observed procedure.
- `steps` and `max_steps`.
- `final_pc` and `fault` (fault text is present exactly for a fault).
- `registers`: changed or explicitly requested register values.
- `memory`: each requested read, with bytes or a per-region error.
- `omitted_registers`: how many register values were not returned.

`returned` means execution reached REA's synthetic sentinel return address. It
does not establish the real calling convention, return-value semantics or
equivalence with the target process.

## Limits

- No OS, library or syscall emulation. An external call without a seeded target
  faults or stays unresolved.
- No automatic stack arguments. Seed `rsp`/stack memory yourself when the
  procedure reads arguments from the stack.
- No 32-bit or floating-point equivalence claims; only the values the p-code
  engine actually produced are reported.
- A step-limit stop is not a hang diagnosis; raise `max_steps` or narrow the
  inputs to observe more.
- Emulation never proves correctness. Treat it as one bounded observation, cite
  it with the seed values, and confirm important conclusions with static or
  runtime evidence.

## Example

Emulate a function that returns a constant after two branches:

```json
{
  "procedure": "0x401000",
  "registers": { "ecx": "0x2a" },
  "max_steps": 500,
  "return_registers": ["eax"]
}
```

An `outcome: "returned"` with `eax` equal to `0x2a` is a reproducible observation
of this emulator state, not proof that the function always returns that value.
