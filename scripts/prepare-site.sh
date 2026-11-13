#!/bin/bash
# Prepare the bundled site for the Xcode build (run by GitHub Actions).
#
# The repo does NOT contain the large/binary site assets (the GitHub MCP
# push used to upload the repo is text-only, max 2,000 files / 16 MiB per
# snapshot), so this script restores them before xcodebuild:
#  1. Binary assets (LXGW fonts, bgm mp3, background jpgs, app icon PNGs)
#     are stored as a base64 tarball (assets-binary.tar.gz.b64) in the repo.
#  2. hanzi-writer-data (9,519 per-character JSON files, 47 MB) is fetched
#     from the public npm tarball hanzi-writer-data@2.0.0.
# The EDB glyph JSONs (glyphs/, 4,722 files) ARE committed in the repo.
set -e
cd "$(dirname "$0")/.."

echo "== decode binary assets bundle =="
base64 -d assets-binary.tar.gz.b64 > /tmp/assets-binary.tar.gz
tar xzf /tmp/assets-binary.tar.gz
rm -f /tmp/assets-binary.tar.gz
echo "fonts: $(ls site/fonts | wc -l) files; bgm: $(ls site/bgm | wc -l)"

echo "== download hanzi-writer-data@2.0.0 from npm =="
curl -sL "https://registry.npmjs.org/hanzi-writer-data/-/hanzi-writer-data-2.0.0.tgz" -o /tmp/hw-data.tgz
rm -rf /tmp/hw-extract && mkdir -p /tmp/hw-extract
tar xzf /tmp/hw-data.tgz -C /tmp/hw-extract
mkdir -p site/hanzi-writer-data
cp /tmp/hw-extract/package/*.json site/hanzi-writer-data/
rm -rf /tmp/hw-extract /tmp/hw-data.tgz
echo "hanzi-writer-data: $(ls site/hanzi-writer-data | wc -l) files"

echo "== site inventory =="
echo "glyphs: $(ls site/glyphs | wc -l) files"
echo "site total: $(du -sh site | cut -f1)"
