## What this changes

<!-- One or two plain sentences. -->

## Why

<!-- The founder decision, readiness item (PB-xx) or bug this serves. -->

## Checks

- [ ] No real PHI, real credentials or secrets anywhere in this change (decision 64)
- [ ] Synthetic data only in tests, fixtures and screenshots
- [ ] Doesn't weaken a permission, consent, authority, audit, family-visibility or default-deny rule
- [ ] Policy questions went to the founder first (no decision made implicitly)
- [ ] Touches frozen demo-baseline files? If yes: the founder's freeze lift is linked, and the manifest is refreshed in this change
- [ ] Documentation updated where behaviour changed; readiness tracker updated if a gap moved
- [ ] CI green
