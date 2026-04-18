import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
	// When `CML_TEST_REPORT_FILE` is set (see `src/test/runTest.ts`), mocha
	// writes a JSON summary there instead of only streaming human-readable
	// output. The outer `runTest.ts` prints a formatted summary from that
	// file after VS Code exits, which is the only output that reliably
	// shows up when the tests are driven from `@vscode/test-electron`.
	const reporterFile = process.env['CML_TEST_REPORT_FILE'];
	const mocha = new Mocha({
		ui: 'tdd',
		...(reporterFile
			? {
					reporter: 'json',
					reporterOptions: { output: reporterFile },
				}
			: {}),
	});

	const testsRoot = path.resolve(__dirname, '..');

	const files = await glob('**/**.test.js', { cwd: testsRoot });

	files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

	return new Promise<void>((c, e) => {
		try {
			mocha.run((failures) => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
				} else {
					c();
				}
			});
		} catch (err) {
			console.error(err);
			e(err);
		}
	});
}
