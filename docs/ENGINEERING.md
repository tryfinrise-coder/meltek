# LT CT engineering workflow

Enable **Construction & electrical engineering** on New design. Choose metering, protection (5P/10P), or special protection (PS/PX). Enter the client specification and its edition, construction, characterized material data, acceptance limits and costs. Confirm the inputs after reviewing them; editing or importing resets confirmation. Incomplete configurations may be saved as drafts but cannot be approved or presented as a feasible recommendation.

The earlier metering workflow remains available with engineering mode disabled. Protection and PS calculations require engineering mode. This document supersedes older phase-one descriptions of those capabilities in the README.

## Information to obtain from the client

- Installed per-side core and outer insulation thicknesses, interlayer insulation, insulated wire diameters, packing factors and parallel-strand arrangement. Nominal insulation names alone do not define finished thickness.
- Material working, saturation and (for PS) characterized knee flux, plus measured excitation components versus flux. Curves must cover the evaluated operating points; the solver does not extrapolate them.
- Frequency, primary/secondary currents, burden and power factor, additional lead resistance, temperature assumptions, allowed ampere-turn loss and excitation limits.
- Metering current/burden test matrix with ratio and phase limits; protection accuracy-limit factor and error limit; PS knee-voltage, resistance and excitation requirements and resistance-formula factor.
- Available tooling, stocked widths, material rates and manufacturing allowances. Confirm which costs the client expects the quoted total to include.

Defaults such as 50 Hz and the copper temperature constant 234.5 are editable working assumptions, not an approved client specification. The fixture under scripts/fixtures is synthetic software test data and must not be used as a manufacturing reference.

## Model and boundaries

The optimizer compares steel-grade × SWG combinations at the configured parallel-strand count. It does not search every possible winding arrangement or number of strands. Single-primary-turn, whole-secondary-turn ring CT construction is assumed.

Core ID/OD account for winding and per-side insulation using a uniform radial-build approximation. Winding capacity uses insulated diameter and the SWG-specific packing factor; finished axial width includes construction build. Core effective area includes stacking factor. Stock-width rounding is followed by a resistance/area recheck. This is a dimensional screening model, not a detailed production winding simulation.

Copper length and mass include all parallel strands; equivalent resistance accounts for parallel conductors. Resistance is reported at room, operating and 75 °C temperatures. Supplied hot-resistance references are used when present; otherwise the configurable temperature correction is applied. Burden voltage includes resistive/reactive components and additional leads.

Metering ratio and phase results use sinusoidal, small-error excitation estimates. Protection composite error is estimated from excitation at the configured accuracy-limit operating point; it is not a waveform or transient fault simulation. PS knee voltage is derived from supplied characterized knee flux, not independently determined from a measured knee-point test. The resistance-based PS formula is explicitly configured and applies to resistive burden. User confirmation does not constitute standards certification.

Ranked options must pass the configured checks and have the required reference data. The cheapest option is cheapest among those evaluated, at the selected material/manufacturing cost basis. Manufacturing cost adds entered insulation, resin, labour and overhead; taxes, margin and other unentered expenses are not implied.

The diagram and rotatable/exportable 3D model follow the selected calculated dimensions. They are conceptual geometry, not fabrication-ready CAD or a substitute for dielectric, thermal, accuracy and fault testing.

## Saved designs and deployment

Calculation saves settings and reference snapshots. Saved reports use these snapshots so subsequent rate changes do not silently reprice a design. Approval requires a feasible selection. Approved, production, archived and superseded designs cannot be edited or recalculated through the ordinary edit endpoint.

JSON, PostgreSQL and MySQL persistence support the engineering specification. SQL initialization adds the nullable engineering_spec JSON column and protection/PS accuracy codes. JSON persistence and API behavior have been exercised end to end; PostgreSQL/MySQL migrations have not been run against a live database in this workspace. Back up and verify the migration on the deployment database before production use.

Use Node 22 or later. Run npm ci and npm run build. The Three.js declaration package is a production dependency because the hosting build may omit development dependencies. Recharts has been migrated to version 3. Do not use npm audit fix --force as a substitute for reviewing upgrades.

Verification commands:

```sh
npm test
npm run build
node scripts/smoke.mjs
node scripts/engineering-smoke.mjs
node scripts/verify-production-build.mjs
npm audit
```

The production-build check creates an isolated temporary checkout of build inputs, installs with --omit=dev, and compiles all workspaces. It does not deploy the application.
