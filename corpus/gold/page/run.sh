#!/bin/zsh
# Has the teacher annotate each page it has not annotated yet, a few at once,
# into teacher/, or with PASS=teacher2 into a second blind pass of the same
# pages (the ceiling in corpus/bench/score.mjs).
#   [PASS=teacher2] corpus/gold/page/run.sh <set>:<id> ...
cd "${0:A:h}"
out=${PASS:-teacher}
mkdir -p $out
for item in "$@"; do
  set_=${item%%:*}; id=${item##*:}
  [[ -s $out/$id.json ]] && continue
  node build.mjs "$set_" "$id" >/dev/null || { echo "$id: build failed"; continue; }
  ( cat task.txt <(printf '\n\n=== THE PAGE ===\n\n') teacher/$id.in.txt | codex exec -m gpt-6-luna -s read-only --skip-git-repo-check --ephemeral --output-schema schema.json -o $out/$id.json - >/dev/null 2>$out/$id.err && rm -f $out/$id.err; echo "$id: $([[ -s $out/$id.json ]] && echo done || echo FAILED)" ) &
  while (( $(jobs -r | wc -l) >= 4 )); do sleep 2; done
done
wait
