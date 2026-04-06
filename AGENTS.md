# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is the **Context Mapper VS Code Extension** — a TypeScript VS Code extension that communicates with a Java-based
LSP server. See `README.md` for user-facing docs and build instructions.

### Key dependencies

- **JDK 17** (minimum) (`JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`) — required for the LSP server binary at
  `lsp/bin/context-mapper-lsp`.
- **Node.js 22.12.0** (minimum; via nvm) — matches `gradle.properties` `nodeVersion`.
- **libsecret-1-dev** — required by `vsce`/`keytar` native module.
- **Xvfb** — VS Code extension tests require a display server.

### LSP server

The Gradle `copyLSPApplication` task downloads the LSP server tar from Maven and extracts it to `lsp/`. The version is
configured in `gradle.properties` as `cmlVersion`. If the configured version is a SNAPSHOT and the SNAPSHOT is no longer
available in the Maven repository, you can manually download the latest stable release from Maven Central
(`org.contextmapper:context-mapper-lsp`) and extract it to `lsp/` with `--strip-components=1`.

### Development commands

| Task              | Command                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Install deps      | `npm ci`                                                                                            |
| Compile TS        | `npm run compile`                                                                                   |
| Lint              | `npx tslint -p ./src`                                                                               |
| Run tests         | `xvfb-run -a npm run test`                                                                          |
| Package .vsix     | `npx vsce package`                                                                                  |
| Full Gradle build | `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 xvfb-run -a ./gradlew clean snapshot vscodeExtension` |

### Gotchas

- The `npm run lint` script uses `-p ./` which fails because `tsconfig.json` is at `src/tsconfig.json`. Use
  `npx tslint -p ./src` instead.
- The Gradle build eagerly resolves the `cmlLSPTar` configuration at project evaluation time, so if the LSP SNAPSHOT
  version is unavailable in Maven, the entire Gradle build will fail — including tasks unrelated to LSP download. In
  that case, use `npm ci && npm run compile && npm run test` directly.
- Tests download a VS Code instance to `.vscode-test/` on first run via the `vscode-test` package. This directory is
  cached after the first run.
- Always set `JAVA_HOME` to JDK 17 when running Gradle or the LSP server, since the system default may be a newer JDK
  version that Gradle 7.5.1 does not support.
- Always use `xvfb-run -a` (or set `DISPLAY`) when running tests headlessly.
