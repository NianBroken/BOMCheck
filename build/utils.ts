/**
 * 使用共享运行文件集合生成 ZIP 格式的 .eext 归档。
 * 全部输入先读入归档对象，再通过唯一临时文件写出；失败时清理自己的临时资源。
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';
import { exportInfo } from '../export-info.mjs';
import { runtimeFiles } from './package-files.mjs';

/**
 * rootDir 是资源基准目录，outputPath 是调用者确定的目标路径。
 * 归档注释保存集中导出身份，每个运行文件保持项目中的相对路径。
 * 流写入成功后重命名目标文件，finally 删除临时路径，不删除调用者已有的完整产物。
 */
export async function packageExtension(rootDir: string, outputPath: string): Promise<void> {
	const zip = new JSZip();
	// ZIP 注释写入集中导出身份，不影响清单文件集合和宿主读取的入口路径。
	zip.comment = JSON.stringify(exportInfo);
	/**
	 * 逐一完整读取允许发布的运行文件，任一缺失都会在创建输出流之前失败。
	 */
	for (const file of runtimeFiles)
		zip.file(file, await readFile(path.join(rootDir, file)));
	/**
	 * 在目标路径旁附加随机 UUID，独占创建避免覆盖其他构建的临时文件。
	 */
	const temporary = `${outputPath}.${randomUUID()}.tmp`;
	try {
		/**
		 * 流处理等待压缩输出与文件写入都完成，DEFLATE 使用最高压缩等级，条目采用流式描述符。
		 */
		await pipeline(zip.generateNodeStream({
			type: 'nodebuffer',
			streamFiles: true,
			compression: 'DEFLATE',
			compressionOptions: { level: 9 },
		}), createWriteStream(temporary, { flags: 'wx' }));
		// 只有压缩流完整写入后才替换目标路径，失败时既不提交半成品也不主动删除既有正式包。
		await rename(temporary, outputPath);
	}
	finally {
		// 正常重命名后临时路径已不存在，失败时强制删除随机命名的残留文件。
		await rm(temporary, { force: true });
	}
}
