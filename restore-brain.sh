#!/usr/bin/env bash
# Restore Malik's Claude brain onto this machine.
#
# After this runs, every `claude` session on this Mac — from any folder, in any
# terminal — loads the house rules, the memory, the skills and the agent
# personas. No asking another computer.
#
#   chmod +x restore-brain.sh && ./restore-brain.sh
#
# Safe to run more than once. It NEVER deletes: anything it would overwrite is
# copied to a timestamped backup first. Run it again after the brain repo
# updates to pull changes down.

set -euo pipefail

REPO_URL="https://github.com/FabAiAgency/claude-brain"
REPO_DIR="${HOME}/Projects/claude-brain"
CLAUDE_DIR="${HOME}/.claude"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${HOME}/.claude-backup-${STAMP}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33m!!\033[0m    %s\n' "$*"; }
info() { printf '        %s\n' "$*"; }

say "Restoring the Claude brain"

# --- 1. The Claude directory ----------------------------------------------
# Claude Code normally creates this on first run, but it doesn't have to exist
# first — files placed here are picked up whenever Claude next starts. Creating
# it ourselves removes a manual step.
if [ -d "$CLAUDE_DIR" ]; then
  ok "found $CLAUDE_DIR"
else
  mkdir -p "$CLAUDE_DIR"
  ok "created $CLAUDE_DIR"
fi

# --- 2. Get the brain ------------------------------------------------------
say "Brain repo"
if [ -d "$REPO_DIR/.git" ]; then
  info "updating existing clone…"
  git -C "$REPO_DIR" pull --ff-only
  ok "updated $REPO_DIR"
else
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone "$REPO_URL" "$REPO_DIR"
  ok "cloned to $REPO_DIR"
fi

# --- 3. Back up anything we are about to touch -----------------------------
say "Backup"
mkdir -p "$BACKUP"
for item in CLAUDE.md settings.json keybindings.json skills plans agents scheduled-tasks; do
  if [ -e "$CLAUDE_DIR/$item" ]; then
    cp -R "$CLAUDE_DIR/$item" "$BACKUP/" 2>/dev/null || true
  fi
done
if [ -n "$(ls -A "$BACKUP" 2>/dev/null)" ]; then
  ok "existing files backed up to $BACKUP"
else
  rmdir "$BACKUP" 2>/dev/null || true
  info "nothing to back up (clean install)"
fi

# --- 4. Copy the layers in -------------------------------------------------
# Deliberately additive. No --delete, ever: RESTORE.md records a dry run that
# reported "nothing would be deleted" and was wrong.
say "Copying rules, skills, plans, agents, tasks"
for f in CLAUDE.md settings.json keybindings.json; do
  if [ -f "$REPO_DIR/$f" ]; then
    cp "$REPO_DIR/$f" "$CLAUDE_DIR/"
    ok "$f"
  else
    info "$f not in the snapshot — skipped"
  fi
done

for d in skills plans scheduled-tasks; do
  if [ -d "$REPO_DIR/$d" ]; then
    mkdir -p "$CLAUDE_DIR/$d"
    cp -R "$REPO_DIR/$d/." "$CLAUDE_DIR/$d/"
    ok "$d/"
  fi
done

# --- 5. Agents — with the world-architect exception ------------------------
# world-architect.md is a PROJECT-level agent. warden-runner.mjs resolves
# --agent world-architect from the fabai-world repo as its cwd. The user-level
# path ~/.claude/agents/world-architect.md has never existed and must not be
# created, or the two copies drift and the kit looks synced while it isn't.
say "Agents"
mkdir -p "$CLAUDE_DIR/agents"
for a in "$REPO_DIR"/agents/*.md; do
  [ -e "$a" ] || continue
  name="$(basename "$a")"
  if [ "$name" = "world-architect.md" ]; then
    continue
  fi
  cp "$a" "$CLAUDE_DIR/agents/"
  ok "${name%.md}"
done

WORLD_AGENTS="${HOME}/Projects/fabai-world/.claude/agents"
if [ -f "$REPO_DIR/agents/world-architect.md" ]; then
  if [ -d "${HOME}/Projects/fabai-world" ]; then
    mkdir -p "$WORLD_AGENTS"
    cp "$REPO_DIR/agents/world-architect.md" "$WORLD_AGENTS/"
    ok "world-architect -> fabai-world (project-level, correct path)"
  else
    warn "world-architect.md NOT installed — fabai-world isn't cloned yet."
    info "It is a project-level agent and must never go in ~/.claude/agents/."
    info "After cloning fabai-world, re-run this script."
  fi
fi

# --- 6. Memory — the step that silently fails ------------------------------
# memory/ does NOT live at ~/.claude/memory/. It goes under the project dir
# Claude derives from the home path: /Users/malik -> -Users-malik
say "Memory"
SLUG="$(printf '%s' "$HOME" | sed 's|/|-|g')"
PROJ_DIR="${CLAUDE_DIR}/projects/${SLUG}"

if [ -d "${CLAUDE_DIR}/projects" ] && [ ! -d "$PROJ_DIR" ]; then
  OTHERS="$(ls -1 "${CLAUDE_DIR}/projects" 2>/dev/null || true)"
  if [ -n "$OTHERS" ]; then
    warn "derived project dir not found: $PROJ_DIR"
    info "these exist instead:"
    printf '%s\n' "$OTHERS" | sed 's/^/          /'
    info "creating the derived one; if Claude uses a different name, memory"
    info "can be moved there later — nothing is lost."
  fi
fi
mkdir -p "$PROJ_DIR/memory"
cp -R "$REPO_DIR/memory/." "$PROJ_DIR/memory/"
ok "memory -> $PROJ_DIR/memory"
info "$(find "$PROJ_DIR/memory" -name '*.md' | wc -l | tr -d ' ') memory files"

# --- 7. Third-party skills the kit deliberately does not vendor ------------
say "Third-party skills"
if [ -d "${CLAUDE_DIR}/skills/img2threejs/.git" ]; then
  ok "img2threejs already cloned"
else
  if git clone --depth 1 https://github.com/img2threejs/img2threejs.git \
       "${CLAUDE_DIR}/skills/img2threejs" 2>/dev/null; then
    ok "img2threejs cloned"
  else
    warn "img2threejs clone failed — clone it by hand later, nothing else breaks"
  fi
fi

# --- 8. What this script cannot do ----------------------------------------
say "Done — but these need your hands"
cat <<'MANUAL'
  These never transfer between machines and must be re-minted:

  1. OAuth        gh auth login   (plus Google / Microsoft sign-ins)
  2. Connectors   reconnect in the Claude app: Gmail, Drive, Canva,
                  Higgsfield, claude-in-chrome
  3. Plugins      Claude prompts from settings.json on first run —
                  approve: caveman, ui-ux-pro-max, openaccountants
  4. Statusline   if it errors, the path points at an old plugin cache.
                  Re-install the caveman plugin, or delete the statusLine
                  block in ~/.claude/settings.json

  Verify it worked — open a NEW terminal and run:
      cd ~ && claude
  then ask it:  what's in your memory index?
  A restored brain answers from MEMORY.md without being handed anything.
  (If Claude Code isn't installed yet, install it and this is all already here
  waiting — nothing needs re-running.)

  Machine data (n8n DB, books dumps, launchd jobs, secrets) is NOT here —
  that lives in the separate machine-vault repo's release. See its MANIFEST.
MANUAL

say "Sync direction — important"
cat <<'SYNC'
  The kit mirrors LIVE ~/.claude  ->  repo. It is a snapshot, not a two-way
  sync. This script runs it the OTHER way (repo -> live), which is correct for
  a restore onto a fresh machine, but it means:

  On the machine you work on daily, ~/.claude is the source of truth.
  Re-snapshot it INTO the repo when it changes. Never run this restore over a
  machine whose ~/.claude is newer than the repo without reading first — that
  is how a day of canon gets overwritten.
SYNC
