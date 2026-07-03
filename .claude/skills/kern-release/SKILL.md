---
name: kern-release
description: Monitor a kern release after pushing a tag — checks CI, release artifacts, and homebrew-tap update in sequence.
---

# kern-release

Use when waiting for a kern release to complete after pushing a tag — monitors CI, release build, and homebrew-tap update in sequence.

## Steps

### 1. Confirm tag pushed

```bash
git tag --sort=-v:refname | head -3
```

Note the tag (e.g. `v0.1.13`).

### 2. Watch CI run

```bash
gh run list --repo thetillhoff/kern --limit 5
```

Two runs fire on a tag push: `CI` and `Release on tag`. Wait for both to show `completed / success`.

For a failing run:

```bash
gh run view <run-id> --log-failed
```

Fix, commit, delete the bad tag, re-push:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# fix, commit, re-tag, push
git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z
```

### 3. Confirm GitHub release created

```bash
gh release view vX.Y.Z --repo thetillhoff/kern --json assets --jq '.assets[].name'
```

Should show all 10 artifacts: `kern_darwin_amd64.tar.gz`, `kern_darwin_arm64.tar.gz`, `kern_linux_amd64.tar.gz`, `kern_linux_arm64.tar.gz`, their four `.sha256` companions, and `kern_windows_amd64.exe` + its `.sha256`.

### 4. Watch homebrew-tap update ⚠️ Always do this step

The `Release on tag` workflow automatically triggers `update-kern.yml` in `thetillhoff/homebrew-tap` via `HOMEBREW_TAP_ACCESS_TOKEN`. **This is what makes `brew upgrade kern` work — don't skip it.**

```bash
gh run list --repo thetillhoff/homebrew-tap --workflow update-kern.yml --limit 3
```

Wait for `completed / success`. If it fails:

```bash
gh run view <run-id> --log-failed --repo thetillhoff/homebrew-tap
```

### 5. Verify formula updated ⚠️ Always do this step

```bash
gh api repos/thetillhoff/homebrew-tap/contents/Formula/kern.rb \
  --jq '.content' | base64 -d | grep -E "version|url|sha256" | head -10
```

Confirm:
- `version` matches the new tag (e.g. `v0.1.15`)
- All four sha256 hashes are present and non-empty
- Formula lives at: https://github.com/thetillhoff/homebrew-tap/blob/main/Formula/kern.rb

### 6. Done

Announce or proceed. The full pipeline from tag push to brew-installable release typically takes 3–5 minutes.
