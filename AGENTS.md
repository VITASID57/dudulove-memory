# DuduLove Memory development

Start with README.md and docs/architecture.md.

- Preserve stable identity IDs, server-enforced access, original record timestamps and editing history across HTTP, MCP and the management page.
- Keep storage and retrieval usable with optional model providers disabled or unavailable.
- Keep modules focused. `npm run check` verifies dependencies, cycles, source size and release file selection.
- Use temporary databases and fictional records for tests. Run `npm test` and `npm run check` for behavior changes; check desktop and mobile layouts for UI changes.
- Write documentation for someone installing the project for the first time. Describe supported behavior, configuration and verified limits directly.
- Release code, example configuration, documentation and tests. Keep operational data and credentials outside version control and release archives.
