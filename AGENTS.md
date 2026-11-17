<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# OpenGridWorks

## What This Is
OpenGridWorks 由网站复刻模板起步，现基于已有网站建设多源异构数据可视化与智能分析平台。

## 当前改进方向

- 以项目根目录的 [技术方案 V11](./TECHNICAL_PROPOSAL_V11_2026-09-28%20%281%29.docx) 为架构、实施和验收依据。沿用现有 Next.js 前端和 PostgreSQL，保持气象、电力、碳三个地球视图的渲染样式，后续专题通过统一的地球适配接口接入。
- 围绕数据查询、交互可视化、统计分析与预测、知识问答四类能力开展开发。按项目保存筛选条件、图表配置、分析结果和证据引用，使结果可追溯到数据版本和原始出处。
- 项目 Agent 统一使用 Pi 运行时。问数状态按项目与独立会话持久化到 PostgreSQL，接入、校验、发布和审批由受控服务执行。
- 按 V11 第 8 节依次推进基线、数据、可视化、算法、知识与调度、交互试运行六个阶段。各阶段先用固定输入验证，再接入真实数据，按对应的验收标准检查。方案中的待决事项在对应阶段核实。
- 改进前的源码基线保存在 Git 标签 `pre-proposal-v11-20261107`，对应提交 `25b3698`。

## V11 阶段进度（Beads）

- 六阶段交付根任务为 `ogw-22p`。使用 `bd list --parent ogw-22p --all --pretty --deps=all` 显示阶段树与顺序依赖，`bd show <阶段 ID>` 查看验收条件和记录。
- 在本项目开启新 Codex 对话时，Beads 钩子会加载项目上下文。收到新对话的第一条用户消息后，先回复阶段树、当前阶段、最近一项已验收完成的工作及下一步；没有关闭的阶段时明确说明暂无阶段验收完成，不根据代码存在推断部署验收通过。
- 如果还没有已关闭的阶段或子任务，检查最近影响应用、数据或部署文档的提交作为代码进展；不要把 Beads/Codex 跟踪配置提交当作产品交付或阶段验收通过。
- V11 阶段按顺序验收。只有某阶段的验收标准均有证据时才关闭对应任务，再进入下一阶段。阶段性代码提交应记录在任务备注中，但不等于阶段验收完成。
- 前四阶段的本轮验收范围与实测依据见 [V11 前四阶段验收记录](./docs/v11-phase-1-4-acceptance.md)。扩展功能和运维演练在 `ogw-22p.9` 下跟踪。
- 收尾时将已验证的完成情况写入相应 Beads 任务。用 `bd close <阶段 ID> --reason "..."` 记录通过依据；如果只完成部分工作，保持阶段未关闭并更新备注或子任务。

## GitHub 更新要求

- 每次完成项目更新（包括代码、配置和文档），运行与变更范围相符的检查，提交本次变更并推送到 GitHub 远端 `origin` 的对应分支。交付时核对远端已包含提交，并报告分支与提交号。若推送失败，保留本地提交并说明具体原因。
- 暂存范围限于本次任务涉及的文件。密钥、数据库备份、未经授权的数据和本地临时文件保留在适当的本地或受控存储中。

## Tech Stack
- **Framework:** Next.js 16 (App Router, React 19, TypeScript strict)
- **UI:** shadcn/ui (Radix primitives, Tailwind CSS v4, `cn()` utility)
- **Icons:** Lucide React (default — will be replaced/supplemented by extracted SVGs)
- **Styling:** Tailwind CSS v4 with oklch design tokens
- **Deployment:** Vercel

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint check
- `npm run typecheck` — TypeScript check
- `npm run check` — Run lint + typecheck + build

## Code Style
- TypeScript strict mode, no `any`
- Named exports, PascalCase components, camelCase utils
- Tailwind utility classes, no inline styles
- 2-space indentation
- Responsive: mobile-first

## Design Principles for Website Emulation
- **Pixel-perfect emulation** — match the target's spacing, colors, typography exactly
- **No personal aesthetic changes during emulation phase** — match 1:1 first, customize later
- **Real content** — use actual text and assets from the target site, not placeholders
- **Beauty-first** — every pixel matters

## Project Structure
```
src/
  app/              # Next.js routes
  components/       # React components
    ui/             # shadcn/ui primitives
    icons.tsx       # Extracted SVG icons as React components
  lib/
    utils.ts        # cn() utility (shadcn)
  types/            # TypeScript interfaces
  hooks/            # Custom React hooks
public/
  images/           # Downloaded images from target site
  videos/           # Downloaded videos from target site
  seo/              # Favicons, OG images, webmanifest
docs/
  research/         # Inspection output (design tokens, components, layout)
  design-references/ # Screenshots and visual references
scripts/            # Asset download scripts
```

## MOST IMPORTANT NOTES
- When launching Claude Code agent teams, ALWAYS have each teammate work in their own worktree branch and merge everyone's work at the end, resolving any merge conflicts smartly since you are basically serving the orchestrator role and have full context to our goals, work given, work achieved, and desired outcomes.
- After editing `AGENTS.md`, run `bash scripts/sync-agent-rules.sh` to regenerate platform-specific instruction files.
- After editing `.claude/skills/clone-website/SKILL.md`, run `node scripts/sync-skills.mjs` to regenerate the skill for all platforms.

@docs/research/INSPECTION_GUIDE.md

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
