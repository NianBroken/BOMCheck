import { randomUUID } from 'node:crypto';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import fs from 'fs-extra';
import JSZip from 'jszip';
import { exportInfo } from '../export-info.mjs';
import { runtimeFiles } from './package-files.mjs';

/**
 * 将多行字符串拆分成字符串数组
 */
export function multiLineStrToArray(str: string): Array<string> {
	return str.split(/[\r\n]+/);
}

/**
 * 检查 UUID 是否合法
 */
export function testUuid(uuid?: string): uuid is string {
	const regExp = /^[a-z0-9]{32}$/;
	if (uuid && uuid !== '00000000000000000000000000000000') {
		return regExp.test(uuid.trim());
	}
	else {
		return false;
	}
}

/**
 * 获取正确的 UUID
 */
export function fixUuid(uuid?: string): string {
	uuid = uuid?.trim() || undefined;
	if (testUuid(uuid)) {
		return uuid.trim();
	}
	else {
		return crypto.randomUUID().replaceAll('-', '');
	}
}

/**
 * 获取要打包的文件列表
 */
export function getPackageFileList(): Array<string> {
	// 运行包只收集明确的入口、资源和许可证，开发目录不会参与递归扫描。
	const files = [...runtimeFiles];
	return files;
}

/**
 * 打包扩展为 eext 文件
 */
export async function packageExtension(rootDir: string, outputPath: string): Promise<void> {
	const fileList = getPackageFileList();
	const zip = new JSZip();
	zip.comment = JSON.stringify(exportInfo);
	// 所有来源读取完成后才创建输出，缺失资源不会留下残缺安装包。
	for (const file of fileList)
		zip.file(file, await readFile(path.join(rootDir, file)));
	const temporary = `${outputPath}.${randomUUID()}.tmp`;
	try {
		await pipeline(zip.generateNodeStream({
			type: 'nodebuffer',
			streamFiles: true,
			compression: 'DEFLATE',
			compressionOptions: { level: 9 },
		}), fs.createWriteStream(temporary, { flags: 'wx' }));
		await rename(temporary, outputPath);
	}
	finally {
		await rm(temporary, { force: true });
	}
}
