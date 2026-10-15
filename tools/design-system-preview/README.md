# Crate v3 visual progress preview

A local review surface for the real `@crate/ui` components and current tokens. It uses fictional
music/library data, bundled brand fonts and the existing workspace tooling. No backend or login
is needed. It is separate from the Listen and Admin production entries.

From the repository root, after `npm install`:

```bash
npm run design-system:preview
```

Open <http://127.0.0.1:5186/#primitivas>. The preview adapts to desktop and mobile. Buttons pause
motion and move the StatNumber caption. System reduced-motion preferences are respected.

```bash
npm run design-system:preview:build
```

The optional static build is written to this directory's ignored `dist/` folder.

## Keep it current

- Extend this same page at each review checkpoint, using the actual component subpath imports.
- Add each new component's source file to the Tailwind `@source` list in `style.css`.
- Show useful states and working controls, with representative fictional data.
- Keep the approved specimens alongside additions so progress remains visible.
- Do not override a specimen's typography or state styling to improve the mockup.
- Check desktop/mobile layout, interactions and browser errors; record the checkpoint and pending
  CI/device QA in the handover. This preview does not replace production visual baselines.

Current: Checkpoint 1A approved by Diego on 2026-10-15: MonoLabel, StatusDot and StatNumber.
