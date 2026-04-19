import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

async function main() {
  // When this runner is launched from a VS Code / Cursor integrated terminal,
  // `VSCODE_*` env vars (VSCODE_ESM_ENTRYPOINT, VSCODE_PID, VSCODE_IPC_HOOK,
  // etc.) are inherited from the parent. @vscode/test-electron spawns the
  // bundled VS Code with `ELECTRON_RUN_AS_NODE=1`, which reads those vars
  // during bootstrap and ends up either attaching to the parent instance or
  // treating itself as an extension host — in which case Mocha silently never
  // runs, runTests() resolves with exit code 0, and the report file is
  // empty. Strip the leaked vars here so the nested VS Code boots cleanly.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_') || key.startsWith('ELECTRON_RUN_AS_NODE')) {
      delete process.env[key];
    }
  }

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cml-vscode-tests-'));
  const reportFile = path.join(scratchDir, 'mocha-report.json');
  const userDataDir = path.join(scratchDir, 'user-data');
  const extensionsDir = path.join(scratchDir, 'extensions');

  let runTestsError: unknown;
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Pass the Electron binary directly, bypassing the `bin/code` bash
    // wrapper. On macOS that wrapper sets `ELECTRON_RUN_AS_NODE=1` and pipes
    // through VS Code's CLI (`cli.js`), which, when launched from inside
    // Cursor's integrated terminal, can silently exit without ever
    // forking the test extension host. Launching Electron directly avoids
    // that whole code path.
    const vscodeExecutablePath = await downloadAndUnzipVSCode({
      extensionDevelopmentPath,
    });

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
      // Use a fresh user-data-dir / extensions-dir per test run so stale
      // SingletonLock / IPC sockets from a previous crashed invocation don't
      // silently make the new VS Code instance attach to a dead process and
      // exit without running the extension test host.
      launchArgs: [`--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`],
      extensionTestsEnv: { CML_TEST_REPORT_FILE: reportFile },
    });
  } catch (err) {
    runTestsError = err;
  }

  const summary = printMochaReport(reportFile);

  if (!summary) {
    if (runTestsError) {
      console.error(runTestsError);
    }
    console.error(
      `No mocha report was produced at ${reportFile}. ` +
        `VS Code likely failed to launch the extension test host — check the logs above.`
    );
    process.exit(1);
  }

  // When `summary.failures > 0`, the `TestRunFailedError` thrown by
  // test-electron is just a consequence of those mocha failures — the
  // formatted summary already shows them, so don't also dump the stack.
  if (summary.failures === 0 && runTestsError) {
    console.error(runTestsError);
    console.error('Failed to run tests');
    process.exit(1);
  }

  if (summary.failures > 0) {
    process.exit(1);
  }
}

interface MochaReport {
  stats: {
    suites: number;
    tests: number;
    passes: number;
    pending: number;
    failures: number;
    duration: number;
  };
  failures: Array<{ fullTitle: string; err: { message: string; stack?: string } }>;
  passes: Array<{ fullTitle: string; duration?: number }>;
  pending: Array<{ fullTitle: string }>;
}

function printMochaReport(reportFile: string):
  | { passes: number; failures: number; pending: number }
  | undefined {
  if (!fs.existsSync(reportFile)) {
    return undefined;
  }
  let report: MochaReport;
  try {
    report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (err) {
    writeLine(`Failed to parse mocha report at ${reportFile}: ${String(err)}`);
    return undefined;
  }

  writeLine('');
  writeLine('Mocha results');
  writeLine('-------------');
  for (const t of report.passes) {
    writeLine(`  PASS  ${t.fullTitle}${t.duration !== undefined ? ` (${t.duration} ms)` : ''}`);
  }
  for (const t of report.pending) {
    writeLine(`  SKIP  ${t.fullTitle}`);
  }
  for (const t of report.failures) {
    writeLine(`  FAIL  ${t.fullTitle}`);
    writeLine(`        ${t.err.message.replace(/\n/g, '\n        ')}`);
    if (t.err.stack) {
      writeLine(
        t.err.stack
          .split('\n')
          .map((l) => `        ${l}`)
          .join('\n')
      );
    }
  }
  writeLine('');
  writeLine(
    `${report.stats.passes} passing, ${report.stats.failures} failing, ${report.stats.pending} pending (${report.stats.duration} ms total)`
  );
  return {
    passes: report.stats.passes,
    failures: report.stats.failures,
    pending: report.stats.pending,
  };
}

// `process.stdout.write` via Node's async pipe can drop buffered output when
// the event loop shuts down before the drain completes. Using `fs.writeSync`
// to fd 1 is a synchronous write that's guaranteed to flush before we exit,
// which matters because we call `process.exit()` immediately after printing.
function writeLine(line: string): void {
  fs.writeSync(1, `${line}\n`);
}

main();