# MELTEK — LT current transformer core design system

See [the engineering workflow and validation boundaries](docs/ENGINEERING.md) for the extended metering, protection and PS design modes, required client data and deployment checks.

A single Node service: the API serves both the JSON API and the built web app,
so it deploys anywhere Node runs.

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Development, with the Vite dev server proxying to the API:

```bash
npm run dev -w @meltek/api       # API on :3000
npm run dev -w @meltek/web       # web on :5173
```

## What it does

Meltek fixes the inner and outer diameter of a moulded CT from the customer's drawing, so
the only free dimension is the width of the steel ring. Too little steel and the core
saturates and the batch is scrapped; too much and money is wasted on a part sold at a
fixed price. This computes every steel grade × wire gauge combination at once, ranks them
by material cost, shows the full working, and remembers the result.

The maths already worked. What this adds is memory, comparison, costing and integration.

## Layout

```
packages/engine   pure TypeScript calculation engine. Zero dependencies, no I/O.
packages/schema   zod schemas shared across the client/server boundary.
apps/api          Express + the store seam (JSON file or PostgreSQL) + Puppeteer PDF.
apps/web          React 19 + Vite + Tailwind v4 + flowbite-react + Motion.
```

## Accounts and roles

Everything behind `/api` requires a session. There is no anonymous access and no way to
act as someone else: the audit log takes the actor from the session, never from a header
the caller could set.

**The built-in administrator.** One account is marked built-in and is recreated at every
startup if it is missing, so the works can never be locked out of its own system — delete
the data file, lose every password, and the next boot still has a way in. It cannot be
deleted, given another role or disabled. Its name, email and password all can be changed,
and the password should be.

Its address defaults to `admin@meltek.local`, overridden with `MELTEK_ADMIN_EMAIL`. The
password comes from `MELTEK_ADMIN_PASSWORD`; when that is not set, a strong one is
generated and written to the log **once, at creation**:

```
created the built-in administrator
    email:    admin@meltek.local
    password: Tjfyzf07GZo9SXA4XHQ-ZlcS
    This is shown once. Sign in and change it, or set MELTEK_ADMIN_PASSWORD.
```

It is deliberately not a fixed default. An undeletable account whose password anyone
could look up is a back door, and this is the account most worth protecting. A restart
never re-passwords an account that already exists, so a password change survives one.

If an ordinary account already holds that address, it is promoted to built-in rather than
colliding, and the log says so.

| Role | What it may do |
|---|---|
| **Viewer** | Read designs, calculations and reference data. Download sheets. Changes nothing. |
| **Engineer** | Raise, edit, calculate, duplicate and archive designs; record manufactured results; maintain customers. |
| **Approver** | Everything an engineer does, plus approving designs and maintaining reference data. |
| **Administrator** | Everything, plus accounts. |

The matrix lives in `packages/schema/src/auth.ts` and is used by both sides: the API
enforces it, and the interface reads the same table to decide what to show. A control
that is hidden is also refused, and a control that is refused is not shown. The interface
gating is a courtesy — the server is the boundary.

**Approval records the signed-in account.** It no longer accepts a typed name, because an
approval is the one record that has to say who actually signed it off.

### How the credentials are held

- Passwords are hashed with **scrypt** (`node:crypto`), a fresh random salt each, and the
  cost parameters stored alongside so they can be raised later without invalidating
  existing accounts. Verification is constant-time.
- The session cookie is random, **httpOnly**, `sameSite=lax`, and `secure` in production
  or when `SECURE_COOKIES=true`. Only the SHA-256 of the token is stored, so a dump of the
  session table cannot be replayed as a login.
- Sign-in is throttled per email and address, and a failed sign-in never reveals whether
  the address exists — the wrong-password path runs the same work either way.
- Changing a password, changing a role or disabling an account **ends that account's
  sessions immediately**, rather than at their next sign-in.
- The last active administrator cannot be demoted, disabled or deleted, and nobody can
  delete the account they are signed in with.
- Cookies, `set-cookie` and every password field are redacted from the logs.

Two limits worth stating plainly. The sign-in throttle is in-process, so a multi-instance
deployment should move it to the database or a shared cache. And CSRF protection rests on
`sameSite=lax` plus the fact that every mutation is a JSON `fetch` — adequate for a
same-origin deployment, but a token is the better answer if this is ever embedded
cross-origin.

## Managing records

Everything in the system can be created, edited and removed from the interface.

**Designs** can be edited in place, duplicated for a repeat order, archived, or deleted.
Editing the specification clears the options costed against the old one and returns the
design to draft — the dialog says so before you commit, rather than leaving you to find
out afterwards. Order fields can be corrected without discarding a calculation.

**Approved and in-production designs cannot be deleted.** They are the record of what was
quoted and built, so the API refuses and the interface offers archiving instead, which
keeps the audit trail and the frozen rates intact. Everything else deletes after typing
the design number to confirm, and the dialog lists what goes with it.

**Reference data** — steel grades and their curves, wire sizes, dies, slit widths and
rates — is fully maintainable, so the works never waits on a deploy to add a grade or a
wire size. Deleting a grade does not disturb designs already approved, because those
carry their own copy of the curve and rate.

**Customers** can be renamed, edited and deleted. A rename updates every design on record
against them. A customer with designs cannot be deleted; the API says how many are in the
way, and the delete button is disabled with the reason on hover.

Every one of these writes an audit entry with the operator's name.

## Interface

The shell is a collapsible rail and a header. The rail collapses to icons below 1280px
and becomes a drawer below 900px, can be pinned open or collapsed by hand, and expands
on hover while collapsed so a narrow screen still gets full labels without losing space.

The header carries the operator, a refresh control that re-fetches reference data and
designs (it spins while anything is in flight), the theme switch, and a notification
feed. The notifications are not decorative: each one is a real open item — an empty die
register, missing slit widths, a grade with no rate, unconfirmed process settings — with
the section of the brief it comes from and a link to where it is fixed.

The account menu shows who is signed in and their role, and offers a password change and
sign out. Signing in or out reloads the application rather than patching the cache, so
nothing from the previous account survives in memory on a shared works machine.

Form controls, dropdowns, tooltips, progress bars and the sidebar come from
**flowbite-react**, themed onto the MELTEK tokens in `apps/web/src/lib/flowbite-theme.ts`
so the components inherit the design system instead of Tailwind's default blue. Tailwind's
`dark:` variant is bound to our `data-theme` attribute, so one switch moves both.

### The engine is a shared pure package

`packages/engine` has no dependencies, no React, no database and no I/O. Both the browser
and the API import the identical module, so:

- the browser recomputes on every keystroke — 96 combinations in about 10 ms, no spinner;
- the server recomputes the same result when persisting, so a tampered client payload
  cannot save a wrong design;
- the engine is testable in isolation against known-good designs.

Reference data is never imported implicitly. Every entry point takes it as an argument:

```ts
solve(inputs, ref, settings, gradeCode, swg)
optimise(inputs, ref, settings)
```

```bash
npm test                              # 88 tests, including the §5.8 vectors
npm run test -w @meltek/engine -- --coverage
```

Coverage is 99% of lines and 100% of functions across the engine.

## Storage

| `DATABASE_URL` | Store | Notes |
|---|---|---|
| unset | JSON file at `DATA_FILE` | Default. No infrastructure. Atomic writes via rename. |
| set | PostgreSQL 16 | `apps/api/src/store/schema.sql` is applied idempotently at boot and seeded on an empty database. |

Both implement the same `Store` interface in `apps/api/src/store/types.ts`. The SQL schema
is the data model of record and follows §7 of the brief exactly.

**The PostgreSQL path has not been exercised against a live database** — none was available
while building. It compiles and follows the schema, but run it against a scratch database
before trusting it with real work. The JSON store is fully exercised.

## Hosting

```bash
docker build -t meltek .
docker run -p 3000:3000 -v meltek-data:/app/data meltek
```

The image is Debian-slim rather than Alpine because Puppeteer's Chromium needs glibc.

With PostgreSQL, pass `DATABASE_URL` and the volume becomes unnecessary. `GET /api/health`
is the health check. See `.env.example`.

## Decisions worth knowing about

**The saturation ceiling applies to every grade.** The client's spreadsheet applies it only
to M-4 and silently reverts to the uncapped value elsewhere. Fixing that changes which
grade wins: Laser Scribed at ₹350/kg needs a wider core than 23 MOH at ₹210/kg once the
ceiling is applied properly. Both `bRawT` and `bUsedT` are recorded and the capping is
surfaced in the table, the chain and the curve.

**The loop converges to a tolerance** rather than stopping at three passes with the value
still moving. The cap and tolerance are process settings, flagged unconfirmed.

**`Math.PI`, and H is not truncated.** The spreadsheet uses `3.1426` and `TRUNC(H,3)`; for
low-loss designs H can be around 0.004, where truncation loses a fifth of the value.

**Rounding happens in millimetres.** The spreadsheet's `CEILING(width,5)` operates on
centimetres and rounds 2.87 cm up to 5 cm.

**Volume is area × magnetic path length.** The spreadsheet multiplies by width a second
time; the area already contains the width.

**Approval freezes the reference data.** The rates, curves and settings used are copied
onto the design record, so updating the copper rate next month cannot silently rewrite
last quarter's quoted costings.

**Everything past spreadsheet cell C93 is marked provisional.** Ordered width, weights and
costs are a physically correct reconstruction of an unfinished part of the workbook. They
carry a `provisional` marker everywhere they appear and `is_provisional` in the database.

**No engineering constant is a literal in application code.** Every one is a
`process_setting` row with an `is_confirmed` flag, a source note and an admin screen.

**Values the works has not set yet are marked, in plain language.** Two flags survive in
the data model and drive what the interface shows:

- `is_confirmed = false` on a process setting means it still holds the shipped default.
  The interface marks it `default` and explains what to consider when setting it.
- `is_provisional` on a costing output means the figure follows the current rate table
  and the rounded slit width. The interface marks it `estimate`.

Neither is decoration. An estimate that has been mistaken for a signed-off price is an
expensive mistake, and a default that has been mistaken for a works figure is a wider
core on every unit. The wording is operational rather than internal: nothing in the
interface refers to the build specification, its section numbers or its open questions.
Those references live in code comments, where they belong.

## Open with the client

Each item is a configurable setting with `is_confirmed = false`, a visible badge, and a
`TODO(client §…)` comment in the source.

| § | Question |
|---|---|
| 12.1 | Winding allowance is hand-entered. `computeWindingAllowance` exists and throws `MissingReferenceData` until the tables arrive. |
| 12.2 | Resin cover — 3 mm per side or 3 mm total? |
| 12.3 | Saturation ceiling trigger: is 1.0 T right, and should 0.65 T be derived per design? |
| 12.4 | The "+5 above 400 A" margin. Implemented behind a flag, default off; where it applies was never stated. |
| 12.5 | How many passes does the client consider correct? |
| 12.6 | 0.2S class factor: sheet says 0.133, client said 0.13. |
| 12.7 | Which slit widths are actually stocked? |
| 12.8 | The die register. Manufacturability checks stay disabled until it exists. |
| 12.9 | 30 MOH rate per kg. That grade cannot be costed or ranked without it. |
| 12.10 | Resistance at 75 °C. Column exists, nullable, shown as missing — never guessed. |

Two more found while building:

**The §5.8 vector table has an inconsistent cell.** The 30 MOH row gives a wire length of
4.373 m, but the formula that reproduces M-4, 23 MOH and Laser Scribed to within 0.01%
gives 3.7912 m from that row's own 20.55 mm width. Read the other way, 4.373 m implies a
24.59 mm width, contradicting the width, area and B in the same row — all three of which
the engine reproduces exactly. The engine is not bent to match the printed figure; the
discrepancy is pinned by a test in `test/vectors.test.ts`.

**The SWG table is seeded with the twelve rows supplied**, not 1–50. The workbook's
Resistance sheet was not provided, and ohm/m and gram/m are engineering values that must
not be invented. Twelve gauges × seven grades is the ~84-combination space the brief sizes.
Admin can add gauges.

## Not built in Phase 1

The 3D module (§13) and the Phase 3 analytics (§14) are out of scope here. The data they
need is not: `manufactured_result` exists in the schema and `POST /api/designs/:id/result`
records it, so the paired design/measurement records that calibration depends on start
accumulating from day one.

On "AI": the honest answer is in §14 of the brief and it is worth repeating. The physics is
deterministic and there are roughly 20 designs on record with no measured outcomes. That is
not a training set. The automation the client asked for is the exhaustive search across
grades and gauges — provably optimal, a few milliseconds, already shipped. The genuinely
valuable model, later, is a regression that calibrates the 0.95 test margin against measured
results, which is ordinary statistics and needs the data above first.

## PDF

`GET /api/designs/:id/pdf` renders a real A4 PDF with Puppeteer, with printed background,
12–14 mm margins and a running footer carrying the design number and page count. One
browser instance is reused across requests and closed on shutdown; each request gets its
own page. `?format=html` serves the same markup unrendered, for working on the stylesheet.

The PDF and the screen cannot drift apart because both render the same markup through the
same print stylesheet (`apps/api/src/sheet.ts`).

If Chromium cannot be launched — a host without the shared libraries, for instance — the
endpoint does not fail. It logs a warning, sets `X-Meltek-Pdf-Fallback: html` and serves
the printable sheet so the operator still gets their document. The Docker image installs
the distro Chromium and points `PUPPETEER_EXECUTABLE_PATH` at it.

## Design studio and engine reliability update

The LT CT workspace includes a responsive glass-style overview, an animated concept
preview (not a manufacturing drawing), a lowest-feasible-cost recommendation and a
batch material estimate. Reduced-motion preferences disable the illustration animation.
All rejected combinations remain inspectable when no feasible design exists.

Cost ranking now uses copper length at the **ordered slit width**, including the same
lead and crossover allowances used by the solver. The converged `wireLengthM` remains
an intermediate for comparison with the supplied calculation vectors; copper weight,
copper cost and BOM length use the ordered geometry. Labour, resin, scrap, overhead and
tax are not included in the material estimate. A populated slit register is a stock
constraint: a fallback width that is not stocked cannot be recommended.

`packages/engine/src/designFamilies.ts` introduces a typed family adapter with separate
solver and search functions. The active family is `lt-ct`. Future products should add
their own input schema, validation, solver and tests through this interface. They will
also need a persisted family discriminator and database migration, API dispatch and
family-specific forms; the existing CT input model must not be reused for incompatible
transformer physics. Existing records continue to mean LT CT without a migration.

Verification:

- `npm test`: original 88 vector tests plus 14 reliability regression cases.
- `npm run build`: engine, schema, browser and API production builds.
- `node scripts/smoke.mjs`: real login and calculator smoke check using a disposable
  JSON store; desktop/mobile screenshots, mobile overflow, reduced motion and the
  no-feasible-result state. Run after building. Requires Puppeteer's installed browser.

Engineering limitations listed above still apply: missing winding tables, unconfirmed
process settings, incomplete stock/tooling data and lack of measured calibration
prevent a claim of production-certified accuracy. New pricing fixes do not recost
previously stored or approved options automatically; create a revision and recalculate.


## Sequential workflow and selected-design views

The new-design screen now presents parameters first, followed by guidance, ranked
combinations, and the selected design. Cards use tighter 8 px corners. The selected
option drives a dimensioned front/side SVG and a lazy-loaded Three.js model on both
new and saved design pages. Drag/pinch, rotate, zoom and reset controls are available;
rendering runs on interaction rather than in a continuous animation loop.

SVG export includes finished diameters and core dimensions. STL export contains only
the steel core, using millimetres and the ordered slit width. Winding loops and
lamination markings are illustrative: the available inputs do not establish actual
wire routing, insulation layers, terminal positions or finished axial depth. If WebGL
is unavailable, the diagram and core export remain available.

Reference-data links now use `/admin?tab=grades` (and corresponding tab names).
Sidebar links, page tabs, notifications, reload and browser history share this state.
Desktop navigation collapses by default and expands on hover or keyboard focus, with
an optional pin. On mobile it remains a drawer that closes after navigation.

The browser smoke test also checks selection-driven model changes, 3D rotation,
SVG/STL downloads, exported dimensions, all reference tabs, browser history, reload,
and hover expansion/collapse.
