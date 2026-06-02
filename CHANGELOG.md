# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.7] - 2026-05-28

### Fixed
- Keep NASA night-light and geographic globe rendering visible at startup while leaving business overlays disabled until selected
- Only fall back from the NASA basemap when a NASA night-light tile request itself fails

## [0.3.6] - 2026-05-28

### Added
- Added slow globe auto-rotation that pauses for user interaction and respects reduced-motion preferences

### Changed
- Start with map visualizations and labels disabled, while keeping left-side controls available for on-demand display
- Defer climate heatmap and Natural Earth overlay data until the related visualization is enabled

## [0.3.4] - 2026-05-27

### Fixed
- Restored transmission voltage classifications and limited the current grid rendering to the China-only local OSM dataset

## [0.3.3] - 2026-05-26

### Fixed
- Improved the satellite basemap release state and aligned the current map fixes under version 0.3.3

## [0.3.2] - 2026-05-26

### Added
- Added a working Esri World Imagery satellite basemap option for the map type switcher

### Fixed
- Kept raster basemaps visible when toggling basemap text labels, limiting that control to label layers

### Changed
- Raised the project Node.js baseline to 24 across local development, CI, Docker, and contributor-facing documentation

## [0.3.1] - 2026-03-29

### Fixed
- `sync-agent-rules.sh` failing to resolve `@file` imports on Windows due to CRLF line endings — platform instruction files now correctly inline the Inspection Guide content

## [0.3.0] - 2026-03-29

### Added
- Multi-URL support for `/clone-website` — clone multiple sites in a single command with parallel processing and isolated output
- CI quality gates via GitHub Actions — automated lint, typecheck, and build on every push and PR
- `npm run typecheck` and `npm run check` scripts for local quality validation
- `.gitattributes` for cross-platform line ending normalization
- `.nvmrc` to pin Node.js 20 for contributor consistency

### Changed
- Streamlined PR template — removed redundant checklist items and screenshots section
- Improved project description and README — clearer use cases, limitations, and modern wording
- Refined documentation and agent rules across all platforms for clarity and consistency
- Fixed CRLF handling in `sync-skills.mjs` for reliable Windows operation

### Removed
- Outdated use case from README documentation

## [0.2.0] - 2026-03-28

### Added
- Multi-platform AI agent support: Claude Code, Codex CLI, OpenCode, GitHub Copilot, Cursor, Windsurf, Gemini CLI, Cline/Roo Code, Continue, Amazon Q, Augment Code, Aider
- Platform-specific instruction files and `/clone-website` skill for each supported agent
- `scripts/sync-agent-rules.sh` to regenerate platform instruction files from AGENTS.md
- `scripts/sync-skills.mjs` to regenerate `/clone-website` skill across all platforms
- GEMINI.md for Gemini CLI configuration
- Supported Platforms table in README
- "Updating for Other Platforms" documentation section in README

### Changed
- README now describes the project as multi-agent (Claude Code recommended, not required)
- AGENTS.md updated with sync script reminders

## [0.1.1] - 2026-03-28

### Added
- Bug report and feature request issue templates
- Pull request template with checklist
- CHANGELOG.md following Keep a Changelog format
- Package.json metadata (description, repository, homepage, keywords, engines)

### Fixed
- LICENSE copyright holder now attributed to JCodesMore

## [0.1.0] - 2026-03-28

### Added
- Initial template scaffold for website reverse-engineering with Claude Code
- `/clone-website` skill for full-site cloning pipeline
- `/build-from-spec` and `/customize` skills
- Parallel builder agents with git worktree isolation
- Chrome MCP integration for design token extraction
- Comprehensive inspection guide and project structure documentation
- Next.js 16 + shadcn/ui + Tailwind CSS v4 base scaffold
- MIT license
- README with badges, demo section, quick start, and star history

[Unreleased]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.7...HEAD
[0.3.7]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.4...v0.3.6
[0.3.4]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/JCodesMore/ai-website-cloner-template/releases/tag/v0.1.0
