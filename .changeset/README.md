# Changesets

This folder is managed by the [@changesets/cli](https://github.com/changesets/changesets) package.

## How to add a changeset

Run `npx changeset` to create a new changeset. Select the change type (patch, minor, major) and write a description.

## Publishing

1. Run `npx changeset version` to bump versions
2. Run `git commit` the updated changelogs and package.json
3. Run `npm run release` to publish to npm
