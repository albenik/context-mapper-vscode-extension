import * as path from 'path';

import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    const vscodeInstallPath = await downloadAndUnzipVSCode({
      extensionDevelopmentPath,
    });
    const vscodeExecutablePath = resolveCliPathFromVSCodeExecutablePath(vscodeInstallPath);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      vscodeExecutablePath,
    });
  } catch (err) {
    console.error(err);
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();