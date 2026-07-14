#!/usr/bin/env sh
set -eu
rm -rf node_modules package-lock.json
npm install --registry=https://registry.npmjs.org/
npm run check
npm test
