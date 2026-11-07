import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 联调输出按运行隔离，截图和临时脚本在正常结束或失败时统一清理。 */
export async function withTestOutput(action) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bomcheck-ui-'));
	try {
		await fs.mkdir(path.join(directory, 'screenshots'));
		await action(directory);
	}
	finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}
