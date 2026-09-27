---
name: typescript-practices
description: Use when writing, editing, reviewing, or running TypeScript or JavaScript. Covers npm environments, existing tooling, imports, types, explicit APIs, and bounded data operations.
---

# TypeScript practices

Keep TypeScript work explicit, reproducible, and within this project's conventions. Apply these practices to the requested changes, not as a reason to restyle surrounding code.

## Environment and tools

- Respect `package.json`, `package-lock.json`, `tsconfig.json`, and the project's npm commands. Use `npm ci` for a clean, locked environment.
- Run project tools through npm scripts or the project-local executable. Do not install global dependencies or let `npx` silently download a missing tool.
- Keep each worktree's `node_modules` and build output local. Do not rely on shell activation or another checkout's dependencies.
- Before resolving a missing import, inspect dependency declarations and module resolution. Ask before upgrading a pinned dependency.
- Keep strict TypeScript checks enabled. Do not suppress checks or change style settings to suit this guide.
- Run relevant existing checks. Do not run broad auto-formatting, paid tools, or unrelated experiments.

## Imports and types

- Follow this project's ESM imports and relative-path conventions. Use explicit named imports and `import type` for type-only dependencies.
- Keep imports at the top of the module. Defer a heavy import only when a real startup or browser-loading boundary requires it.
- Use `unknown` for untrusted values and narrow them with validation. Do not use `any`, double assertions, or non-null assertions to hide missing checks.
- Describe valid states with discriminated unions. Use exhaustive handling when adding a variant must require changes in every consumer.
- Use `readonly` arrays and properties for read-only inputs. Keep mutation explicit at the owner, including the simulation's draft-update boundary.
- Use descriptive names and existing conventions. Function and method names start with a verb. Keep private helpers beside their owner.

## Functions and entry points

- Use a typed options object when several positional arguments would hide intent. Keep simple calls simple.
- Forward parsed command-line options explicitly. Do not spread an arbitrary argument bag into another API.
- Test argument forwarding with distinct, meaningful values so missing or swapped options fail.
- Await promises or return them to a caller that does. Handle rejected promises at the boundary and fail visibly. Never use an empty catch or an invented default to hide an error.
- Keep stateful behavior on its owner and use functions for stateless transformations. Apply [Responsibility-driven design](../responsibility-driven-design/SKILL.md).

## Strings, paths, and data

- Use template literals for interpolation and `node:path` or file URLs for Node filesystem paths. Keep Node APIs out of browser modules.
- Validate JSON and external inputs at runtime. TypeScript types are erased and cannot validate a save file or network response.
- Stream large files and process data in bounded chunks. Do not materialize an entire dataset in memory.
- Use explicit units and preserve the project's map-to-meter conversions. Do not mix simulation units and display units.
- Use the world RNG for simulation randomness and the existing render-only generator for visual noise. Do not invent seed defaults.

## Documentation and tests

- Explain non-obvious constraints, units, and invariants. Do not narrate obvious code or document untouched code.
- Apply [Testing practices](../testing-practices/SKILL.md). Use Vitest for game logic and real temporary repositories for hook behavior.
- Run `npm run quality` before committing. Stage the intended files and let the pre-commit hook check the index. Do not disable the hook or loosen its configuration to get a commit through.
- Finish with the checks actually run, their results, and anything untested. Do not expand the task to satisfy this guide.
