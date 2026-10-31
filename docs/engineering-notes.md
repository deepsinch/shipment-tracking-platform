# Engineering notes

Deep dives into the problems in Waybill worth discussing: what made each one hard, what we chose,
what we rejected, and what would change at scale. The design itself is in
[architecture.md](./architecture.md); this document is about the reasoning.

## Shipment status as a state machine

**Problem.** A status column lets any code set any value: a shipment could jump from `created` to
`delivered`, or come back from `cancelled`. The UI also needs to know which actions to offer.

**Approach.** The transition table lives in one pure module,
[`src/domain/shipment-status.ts`](../src/domain/shipment-status.ts). The UI calls
`allowedNextStatuses()` to render only valid actions; the server calls `canTransition()` and rejects
everything else. Terminal states are derived (no outgoing transitions), not listed separately.

**Tradeoffs.**

- Database check constraints validate values, not transitions. A trigger could validate transitions,
  but the rules would then live in two languages. One module, tested, is simpler.
- The tests restate the transition table independently and check every pair of statuses, so an
  accidental edit to the table fails loudly instead of silently allowing a new path.

**At scale.** Per-customer workflows (e.g. a "customs hold" status for international carriers) would
move the table from code into data, with the same `canTransition` interface.

**Likely questions.** Why not a library like XState? (Seven states and a flat table do not need one;
it would add a dependency and a learning curve for no new capability.)

## Unguessable tracking codes

**Problem.** Customers see the shipment's code on a public page with no login. Sequential ids can be
enumerated; UUIDs are hostile to read over the phone or type on a mobile keyboard.

**Approach.** `WB-XXXX-XXXX` in Crockford base32, generated in
[`src/domain/tracking-code.ts`](../src/domain/tracking-code.ts):

- Exactly 5 random bytes (40 bits) become exactly 8 base32 symbols, so there is no modulo bias.
- The alphabet drops I, L, O and U. Input is normalized: case, spaces and dashes are ignored and
  look-alikes are mapped (I and L read as 1, O as 0), so a code read aloud still works.
- Plain number arithmetic instead of BigInt: 40 bits is far below 2^53, and it compiles under
  Next.js's default ES2017 target.
- A unique index plus retry handles the rare collision.

**Tradeoffs.** 40 bits is about 1.1 trillion codes. With a million live shipments a random guess hits
about 1 in a million; rate limiting the public page closes the gap. Longer codes are harder to read
aloud.

**At scale.** Lengthen the code, or require a second factor (destination postcode) to see full
details.

## Building on a framework newer than the docs you remember

**Problem.** The project uses Next.js 16.4, whose defaults differ from the versions most tutorials
(and AI models) know: Cache Components is on, middleware is now `proxy.ts`, and typed route props
such as `LayoutProps` only exist after a code-generation step.

**Approach.** Build against the docs that ship inside the installed package
(`node_modules/next/dist/docs/`) rather than memory. Two concrete results:

- `pnpm typecheck` runs `next typegen` before `tsc`, otherwise a fresh clone fails with
  "Cannot find name LayoutProps".
- With Cache Components, reading cookies, headers, `params` or `searchParams` outside a `<Suspense>`
  boundary is a build error. Dynamic pages get a `loading.tsx` and layouts stream the session in;
  this was planned before writing auth code, not discovered as a build failure.

**Tradeoffs.** Turning Cache Components off would have meant familiar patterns, but it is the
direction the framework is going, and static shells with streamed dynamic parts are faster for users.
