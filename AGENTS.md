# AGENTS.md

## Cursor Cloud specific instructions

### Overview

This is the **Context Mapper VS Code Extension** — a TypeScript VS Code extension that communicates with a Java-based
LSP server. See `README.md` for user-facing docs and build instructions.

### Key dependencies

- **JDK 25** (LTS) — **Eclipse Temurin** recommended (same distribution as CI via `actions/setup-java` with
  `distribution: temurin`). Required for Gradle and for running the LSP server binary. The LSP is downloaded and
  extracted to `lsp/` (entrypoint: `lsp/bin/context-mapper-lsp`) by the Gradle **`copyLSPApplication`** task, so this
  path only exists after `./gradlew copyLSPApplication` (or any task that depends on it, such as `npmInstall`,
  `vscodeExtension`, or `test`) has run.
- **Node.js 22.13.0** — pinned in [`gradle.properties`](gradle.properties) as `nodeVersion`. The
  `com.github.node-gradle.node` plugin **downloads this exact version** into `.gradle/nodejs/` when `download = true`,
  so Gradle tasks ignore a locally installed Node. CI uses the same pin via `actions/setup-node` — see
  [`.github/workflows/build.yml`](.github/workflows/build.yml).
- **libsecret-1-dev** (Linux only) — required by `@vscode/vsce` / `keytar` native module when publishing with the
  credential store; not needed for build or tests.
- **Xvfb** (headless Linux only) — VS Code extension tests launch a VS Code window and need a display server. Not
  required on macOS or Windows, nor on Linux with a real X/Wayland session.

#### JDK vendor choice

Use **Eclipse Temurin** unless you have a policy that requires another vendor (e.g. Amazon Corretto, Microsoft Build of
OpenJDK, Oracle JDK). Temurin tracks OpenJDK LTS with broad tooling support and matches GitHub Actions in this repo.

#### Installing JDK 25 locally (if missing)

- **macOS (Homebrew)** — install the Temurin cask, then point `JAVA_HOME` at the JDK 25 home (adjust the path if your
  Homebrew prefix differs):

  ```bash
  brew install --cask temurin@25
  export JAVA_HOME="$(/usr/libexec/java_home -v 25)"
  java -version
  ```

  If `temurin@25` is unavailable from Homebrew yet, install JDK 25 from [Adoptium](https://adoptium.net/) and set
  `JAVA_HOME` to the extracted `Contents/Home` (macOS) or the unpacked JDK root (Linux).

- **Linux (apt, Temurin packages)** — use Eclipse Temurin’s Debian/Ubuntu packages from Adoptium, then set `JAVA_HOME` to
  the installed JDK directory (commonly under `/usr/lib/jvm/`, e.g. `temurin-25-jdk-amd64`).

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
| Lint              | `npm run lint` (runs `eslint src`)                                                                  |
| Run tests         | `xvfb-run -a npm run test`                                                                          |
| Package .vsix     | `npx @vscode/vsce package`                                                                          |
| Full Gradle build | `JAVA_HOME=<path-to-jdk-25> xvfb-run -a ./gradlew clean snapshot vscodeExtension`                   |

### Practical notes (tests and Gradle)

- **`npm run test`** compiles TypeScript (`pretest`) and runs `out/test/runTest.js`, which uses **`@vscode/test-electron`**
  (see [`src/test/runTest.ts`](src/test/runTest.ts)). On the first run it downloads a full VS Code build (~200 MB) into
  **`.vscode-test/`**; later runs reuse the cache. Restricted or sandboxed environments may fail during unzip with
  errors such as “Operation not permitted” under `.vscode-test/` — run tests on a normal workstation filesystem, or use
  CI (Linux + Xvfb; see [`.github/workflows/build.yml`](.github/workflows/build.yml)).
- **Gradle `checkVersion`** (runs before `test` and `vscodeExtension`) compares the Gradle/Nebula-inferred version with
  **`package.json` `"version"`**. Behavior is asymmetric:
  - **`./gradlew snapshot <task>`** forces Gradle to `0.1.0-SNAPSHOT`. A mismatch is only a **warning**, so this path
    works even if `package.json` has a fixed version (`1.0.0` in the repo today).
  - **`./gradlew <task>` without `snapshot`** lets Nebula infer a dev version from git state (e.g.
    `0.1.0-dev.N.uncommitted+<sha>`). A mismatch with `package.json` is then **fatal**.

  CI avoids the fatal path by reading `./gradlew properties --console=plain --no-daemon | grep '^version:'` and running
  **`npm pkg set "version=<that value>"`** before **`npm ci`** — see
  [`.github/workflows/build.yml`](.github/workflows/build.yml). For a local `./gradlew test` or `./gradlew vscodeExtension`,
  either prepend **`snapshot`** (simplest) or perform the same sync first and **`git checkout -- package.json package-lock.json`**
  afterwards to restore the committed version.
- **Headless Linux** — use **`xvfb-run -a npm run test`** (or run `./gradlew test` under Xvfb) so the downloaded VS Code
  process has a display. Not needed on macOS/Windows.

### Gotchas

- **`npm run lint`** runs ESLint on `src/`; it exits 0 even when warnings are reported, so treat it as advisory unless
  your workflow promotes warnings to errors.
- **`tsconfig.json` lives at [`src/tsconfig.json`](src/tsconfig.json)**, not repo root. The `compile` script is
  `tsc -p ./src`. Any manual `tsc` invocation from repo root must point at that path (e.g. `npx tsc -p ./src`).
- The Gradle build eagerly resolves the `cmlLSPTar` configuration at project evaluation time, so if the configured
  `cmlVersion` (SNAPSHOT or otherwise) is unavailable in Maven, the entire Gradle build fails — including tasks
  unrelated to the LSP download. In that case, either pin `cmlVersion` in [`gradle.properties`](gradle.properties) to an
  available release or bypass Gradle and use `npm ci && npm run compile && npm run test` directly.
- Use **JDK 25** for Gradle and the LSP server. The Gradle wrapper is pinned to **9.4.1**
  (see [`gradle/wrapper/gradle-wrapper.properties`](gradle/wrapper/gradle-wrapper.properties)); avoid mixing in an older
  JDK that cannot run this Gradle version.
