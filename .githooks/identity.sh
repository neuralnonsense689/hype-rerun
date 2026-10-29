# Shared settings for this repo's hooks. Public account only.
WANT_NAME="neuralnonsense689"
WANT_EMAIL="349880598+neuralnonsense689@users.noreply.github.com"
WANT_REMOTE="github.com/neuralnonsense689/"
# Personal details that must never reach this repo. The list lives outside version control
# (one extended regex in .git/info/personal-patterns) so it is never published itself.
patterns_file="$(git rev-parse --git-dir)/info/personal-patterns"
if [ ! -s "$patterns_file" ]; then
  echo "hook: $patterns_file is missing; refusing until it exists." >&2
  exit 1
fi
PERSONAL=$(cat "$patterns_file")
