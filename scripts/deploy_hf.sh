#!/usr/bin/env bash
# Push this repo to a Hugging Face Space (Docker SDK, free CPU Basic).
#   1. Create the Space at https://huggingface.co/new-space  (SDK: Docker, hardware: CPU basic, free)
#   2. In the Space settings add secrets: TOKEN_FACTORY_API_KEY, TAVILY_API_KEY
#      and variables: VOUCH_PROVIDER=tokenfactory, VOUCH_MODE=hosted, VOUCH_PUBLIC_URL=https://<user>-<space>.hf.space
#   3. huggingface-cli login   (or export HF_TOKEN)
#   4. bash scripts/deploy_hf.sh <user>/<space>
set -euo pipefail
SPACE="${1:?usage: deploy_hf.sh <user>/<space>}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git ls-files -z | xargs -0 -I{} cp --parents {} "$TMP"/ 2>/dev/null || git archive HEAD | tar -x -C "$TMP"
# The Space needs its own README with Spaces metadata; keep the GitHub README alongside it.
mv "$TMP/README.md" "$TMP/GITHUB_README.md"
cp deploy/hf-space/README.md "$TMP/README.md"
cd "$TMP"
git init -q -b main
git add -A
git -c user.name="vouch-deploy" -c user.email="deploy@vouch.local" commit -qm "Deploy Vouch"
REMOTE="https://huggingface.co/spaces/${SPACE}"
if [ -n "${HF_TOKEN:-}" ]; then
  REMOTE="https://user:${HF_TOKEN}@huggingface.co/spaces/${SPACE}"
fi
git push --force "$REMOTE" main
echo "Pushed. Build logs: https://huggingface.co/spaces/${SPACE}?logs=build"
