import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { exportInfo } from '../export-info.mjs';
import { runtimeFiles } from './package-files.mjs';

/** 资源完整读取后生成临时归档，成功后原子替换目标文件。 */
export async function packageExtension(rootDir: string, outputPath: string): Promise<void> {
	const zip = new JSZip();
	zip.comment = JSON.stringify(exportInfo);
	for (const file of runtimeFiles)
		zip.file(file, await readFile(path.join(rootDir, file)));
	const temporary = `${outputPath}.${randomUUID()}.tmp`;
	try {
		await pipeline(zip.generateNodeStream({
			type: 'nodebuffer',
			streamFiles: true,
			compression: 'DEFLATE',
			compressionOptions: { level: 9 },
		}), createWriteStream(temporary, { flags: 'wx' }));
		await rename(temporary, outputPath);
	}
	finally {
		await rm(temporary, { force: true });
	}
}
