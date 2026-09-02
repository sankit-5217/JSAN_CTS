# Contributing — two-developer workflow

This is the day-to-day process for **Dev A (@Ankit5217)** and **Dev B (@Anshul1505-he)**, working from two different machines on the same repo in VS Code. It exists to answer one question: _how do we both push code without stepping on each other?_

Module ownership itself (who builds what) is in `docs/PROJECT_OVERVIEW.md` and `CLAUDE.md`. This doc is about the git/GitHub mechanics that keep that split from colliding.

## 1. One-time setup (each machine)

```bash
git clone https://github.com/Ankit5217/JSAN_CTS.git
cd JSAN_CTS
nvm use            # reads .nvmrc — Node 20
corepack enable     # picks up the pinned pnpm version from package.json
pnpm install
cp .env.example .env
```

Open the folder in VS Code and accept the "install recommended extensions" prompt (`.vscode/extensions.json`: ESLint, Prettier, Prisma, GitLens, GitHub PRs). `.vscode/settings.json` turns on format-on-save for both of you — this alone eliminates most of the noise diffs that cause fake merge conflicts between two machines.

## 2. Branch model

`main` is protected — nobody pushes to it directly, including admins. All work happens on short-lived branches, merged via PR.

**Naming convention** — prefix by who's driving, not by machine:

```
dev-a/<module>-<short-description>     # e.g. dev-a/cmdb-ci-crud
dev-b/<module>-<short-description>     # e.g. dev-b/alerts-ingest-endpoint
```

This makes `git branch -a` and the PR list self-explanatory, and means you never both grab the same branch name by accident.

**Every work session:**

```bash
git checkout main
git pull origin main
git checkout -b dev-a/incidents-transition-service   # new branch per story
# ...work...
git push -u origin dev-a/incidents-transition-service
```

Open a PR into `main` as soon as there's something reviewable — don't sit on a branch for days, it only makes conflicts bigger later.

## 3. Who reviews what

`.github/CODEOWNERS` auto-requests the right reviewer based on the files a PR touches — it mirrors the ownership table in `CLAUDE.md`. In short:

| You touch...                                                                                      | Reviewer requested |
| ------------------------------------------------------------------------------------------------- | ------------------ |
| `apps/api/src/modules/{auth,sites,cmdb,incidents,worklogs,sla,audit,reports}/`                    | @Ankit5217         |
| `apps/api/src/modules/{alerts,vendors,changes,knowledge,risks}/`, `apps/worker/`, `integrations/` | @Anshul1505-he     |
| Anything in **Shared files** below                                                                | both               |

Branch protection requires that CODEOWNERS review before merge — see §6.

## 4. Shared files — the actual conflict risk

Splitting by module (§`docs/PROJECT_OVERVIEW.md`) means you're rarely editing the same file. The exceptions are the handful of files every module touches. Treat these as "ping before you edit, not after":

| File                                                               | Why it's risky                                                                                              | Rule                                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                                    | Both of you add models; Prisma migrations are ordered and a diverged migration history is painful to unwind | See §5 below — this one gets its own protocol                                                               |
| `apps/api/src/app.module.ts`                                       | Every new module gets registered here                                                                       | Small, additive edits only — add your import + one line in the `imports` array, don't reorder others' lines |
| `packages/shared-types/`                                           | Enums both frontends/backends import                                                                        | Adding a new type is safe; renaming/removing an existing one needs a heads-up, both of you likely import it |
| `package.json` (root), `pnpm-workspace.yaml`, `docker-compose.yml` | Workspace-wide config                                                                                       | Message the other dev before adding a new top-level dependency or service                                   |
| `.github/workflows/ci.yml`, `.github/CODEOWNERS`                   | Affects both of your PRs                                                                                    | Same — ping first                                                                                           |

**The actual rule:** if your change touches one of these, say so in your team chat _before_ you start (not after you've already diverged), and tag both of you as reviewers on the PR (the PR template has a checkbox for this). A 30-second message beats a merge conflict resolved under deadline pressure.

## 5. Prisma schema protocol

This is the single highest-risk shared file, so it gets explicit rules:

1. **Pull `main` and re-run `pnpm prisma:generate` before you start** any work that touches `schema.prisma` — you want to be building on the latest model shapes, not last week's.
2. **Additive changes are safe to do independently**: adding a new model, or a new optional field to a model you own. Add it, run `pnpm --filter @cts-dc-opsdesk/api prisma migrate dev --name <description>`, commit the generated migration folder under `apps/api/prisma/migrations/`.
3. **Never rename or delete a field/model you don't own** without asking first — the other dev's module may depend on it (e.g. `Incident.ciId` is written by Dev A's `incidents` module but read by Dev B's `alerts`/`vendors` modules).
4. **Only one dev runs `prisma migrate dev` at a time** if you're both mid-change — two uncommitted migrations racing against the same dev database produces a migration history neither of you can cleanly merge. If you're both touching the schema in the same window, do it on a call, not in parallel.
5. If a migration conflict does happen (two migration folders with overlapping timestamps after a merge), the fix is `prisma migrate resolve` or, in dev, `prisma migrate reset` against a throwaway local DB — never edit an already-applied migration file in place.

## 6. Branch protection (one-time GitHub setup)

I don't have GitHub API/admin access from this environment to flip these on for you, so do this once as the repo owner (@Ankit5217), takes about 2 minutes:

1. **Push `main`** (done — see below) and set it as the default branch: **Settings → General → Default branch → switch to `main`**.
2. **Settings → Branches → Add branch protection rule**, pattern `main`:
   - ✅ Require a pull request before merging
   - ✅ Require approvals — set to **1**
   - ✅ Require review from Code Owners
   - ✅ Require status checks to pass before merging → select **`build-and-test`** (the CI job in `.github/workflows/ci.yml`; it won't appear in the list until CI has run at least once on `main`, which happens automatically on the first push)
   - ✅ Do not allow bypassing the above settings (include administrators)
   - ❌ Leave "Allow force pushes" and "Allow deletions" unchecked
3. **Settings → Collaborators → Add people** → add `Anshul1505-he` with **Write** access (CODEOWNERS review requests only work for people with repo access).

After this, neither of you can push straight to `main`, and every PR needs the right owner's approval + a green CI run before it merges — that's the actual mechanism that stops silent stepping-on-each-other.

## 7. Keeping your branch current

Prefer rebase over merge-from-main, it keeps history linear and makes the eventual PR diff readable:

```bash
git fetch origin
git rebase origin/main
# resolve any conflicts, then:
git push --force-with-lease
```

Use `--force-with-lease`, never plain `--force` — it refuses to overwrite work if the remote branch has commits you haven't seen (e.g. a review comment fix pushed from your other machine).

## 8. Commit messages

Prefix with the module or area, imperative mood, no period:

```
sites: add support-calendar CRUD
worker: add sla-timers escalation job
schema: add VendorCase.replacementPart field
```

Keep commits reviewable-sized — a PR that's "one story" is easier for the other dev to review in the 10 minutes they have between their own work than a 40-file drop at the end of the week.

## 9. Daily sync

You're on separate machines with no hallway conversation, so replace it deliberately:

- A short async message (chat/Slack/WhatsApp — whatever you already use) at the start and end of each session: what you're starting, what you finished, anything you touched in the **shared files** list.
- Open PRs early (draft PRs are fine) so the other dev sees direction before it's finished, not just the final diff.
- If `cmdb` (Dev A) is blocking something Dev B needs, say so explicitly rather than working around it — the module boundary in `docs/PROJECT_OVERVIEW.md` calls this out as the one hard dependency between the two tracks.
