# Calculator compatibility baseline

`pre-redesign-calculations.json` records the established numerical results for 11 scenarios from calculation-engine commit `e1ff7be`. The engine source was unchanged by the frontend redesign. The later configurable rounding feature is intentionally excluded from this historical baseline; its behaviour has dedicated tests.

The compatibility suite exercises the production form adapter with both numeric and browser string values, automatic and fixed wire selection, and the JSON/schema boundary used when saving. It compares geometry, winding build, electrical values, convergence, weights, costs, feasibility and rankings. Timing is intentionally excluded.

These snapshots protect existing behavior. Do not regenerate them as part of a visual redesign. An intentional calculation-rule change needs separately reviewed expected values. They verify compatibility with the existing calculator, not independent physical certification.
