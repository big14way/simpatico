#!/usr/bin/env bash
# Fails if anything that must stay private is tracked or staged:
#   - .env files (other than .env.example)
#   - private planning notes
#   - a Qloo hackathon key, or any other high-entropy key pattern we know about
#   - raw Qloo response dumps (Qloo's terms: no response data in a public repo)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
files=$( (git ls-files; git diff --cached --name-only --diff-filter=ACMR) | sort -u)

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .env.example) ;;
    .env|.env.*|*/.env|*/.env.*) echo "guard: env file is tracked: $f"; fail=1 ;;
    SIMPATICO_BLUEPRINT.md|*/SIMPATICO_BLUEPRINT.md) echo "guard: private notes are tracked: $f"; fail=1 ;;
    .data/*|recordings/*|*.qloo.json) echo "guard: Qloo response data is tracked: $f"; fail=1 ;;
  esac
done <<< "$files"

# Content scan of tracked + staged files (index version).
if git grep --cached -nIE 'hack_[0-9a-f]{40}' -- . ':!scripts/guard.sh' ':!.gitleaks.toml' >/dev/null 2>&1; then
  echo "guard: a Qloo hackathon key is present in tracked files:"
  git grep --cached -nIlE 'hack_[0-9a-f]{40}' -- . ':!scripts/guard.sh' ':!.gitleaks.toml'
  fail=1
fi
if git grep --cached -nIE '(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|re_[A-Za-z0-9]{20,}|secret_[A-Za-z0-9]{40,}|ntn_[A-Za-z0-9]{40,}|hooks\.slack\.com/services/T[A-Z0-9]+/)' -- . ':!scripts/guard.sh' ':!.gitleaks.toml' >/dev/null 2>&1; then
  echo "guard: something that looks like an API key or webhook is tracked:"
  git grep --cached -nIlE '(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|re_[A-Za-z0-9]{20,}|secret_[A-Za-z0-9]{40,}|ntn_[A-Za-z0-9]{40,}|hooks\.slack\.com/services/T[A-Z0-9]+/)' -- . ':!scripts/guard.sh' ':!.gitleaks.toml'
  fail=1
fi

if git grep --cached -nIE 'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@|npg_[A-Za-z0-9]{12,}' -- . ':!scripts/guard.sh' ':!.gitleaks.toml' >/dev/null 2>&1; then
  echo "guard: a database URL with a password is tracked:"
  git grep --cached -nIlE 'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@|npg_[A-Za-z0-9]{12,}' -- . ':!scripts/guard.sh' ':!.gitleaks.toml'
  fail=1
fi

if [ "$fail" -ne 0 ]; then echo "guard: FAILED"; exit 1; fi
echo "guard: ok ($(echo "$files" | grep -c . ) files checked)"
