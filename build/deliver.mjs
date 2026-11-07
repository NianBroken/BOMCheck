import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { packageName } from './metadata.mjs';
import { deliveryDocuments } from './package-files.mjs';
import { sha256, verifyDelivery, verifyPackage } from './verify-delivery.mjs';

/** 交付只包含当前安装包、校验值与必要文档，不携带历史报告。 */
async function main() {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	process.chdir(root);
	const directory = path.resolve(root, 'delivery');
	assert.equal(path.dirname(directory), root);
	const bytes = await fs.readFile(path.join(root, 'build/dist', packageName));
	const checked = await verifyPackage(bytes);
	await fs.rm(directory, { recursive: true, force: true });
	await fs.mkdir(directory, { recursive: true });
	const files = [...deliveryDocuments, packageName, `${packageName}.sha256`];
	for (const filename of deliveryDocuments) {
		const target = path.join(directory, filename);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.copyFile(path.join(root, filename), target);
	}
	await fs.writeFile(path.join(directory, packageName), bytes);
	await fs.writeFile(path.join(directory, `${packageName}.sha256`), `${checked.sha256}  ${packageName}\n`, 'utf8');
	const sums = [];
	for (const filename of files)
		sums.push(`${sha256(await fs.readFile(path.join(directory, filename)))}  ${filename}`);
	await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), `${sums.sort().join('\n')}\n`, 'utf8');
	const result = await verifyDelivery();
	console.log(JSON.stringify({ delivery: directory, ...result }, null, 2));
}
void main();
