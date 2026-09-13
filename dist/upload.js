import { K as getRootLogger, S as UPLOAD_ISSUE_CODES, U as env, n as BadRequest, pt as validationError, rt as parseBytes, st as resolveConfig, ut as setUploadsParser } from "./dist-BLfGRdiS.js";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";
import { tmpdir } from "node:os";
//#region ../upload/dist/index.js
/**
* Runtime `UploadedFile`. Backed by a temp-dir path or an in-memory buffer.
* Tracks `moved`/`kept`/`discarded` so request cleanup knows what to leave alone.
*/
var UploadedFileImpl = class {
	field;
	filename;
	mimeType;
	size;
	path;
	buffer;
	moved = false;
	kept = false;
	discarded = false;
	constructor(data) {
		this.field = data.field;
		this.filename = data.filename;
		this.mimeType = data.mimeType;
		this.size = data.size;
		if (data.path !== void 0) this.path = data.path;
		if (data.buffer !== void 0) this.buffer = data.buffer;
	}
	stream() {
		if (this.discarded) throw new Error(`Upload "${this.filename}" was already discarded`);
		if (this.buffer) return Readable.from(this.buffer);
		if (this.path) return createReadStream(this.path);
		throw new Error(`Upload "${this.filename}" has no content`);
	}
	async move(to) {
		if (this.discarded) throw new Error(`Upload "${this.filename}" was already discarded`);
		await mkdir(dirname(to), { recursive: true });
		if (this.path) try {
			await rename(this.path, to);
		} catch (error) {
			if (error.code === "EXDEV") {
				await copyFile(this.path, to);
				await unlink(this.path);
			} else throw error;
		}
		else if (this.buffer) await writeFile(to, this.buffer);
		this.moved = true;
		this.path = to;
		return to;
	}
	keep() {
		this.kept = true;
	}
	async discard() {
		if (this.discarded || this.moved) return;
		if (this.path) await unlink(this.path).catch(() => {});
		this.discarded = true;
	}
};
const DEFAULTS = {
	FILE_TOO_LARGE: (m) => `File "${m.filename}" exceeds the maximum size of ${m.limit} bytes`,
	FILE_TYPE_NOT_ALLOWED: (m) => m.detected ? `File "${m.filename}" has type "${m.detected}" which is not allowed (expected ${(m.allowed ?? []).join(", ")})` : `File "${m.filename}" has an unrecognised type (expected ${(m.allowed ?? []).join(", ")})`,
	TOO_MANY_FILES: (m) => `Field "${m.field}" accepts at most ${m.limit} file${m.limit === 1 ? "" : "s"}`,
	FILE_REQUIRED: (m) => `Field "${m.field}" is required`,
	UNEXPECTED_FILE: (m) => `Unexpected file field "${m.field}"`,
	TOTAL_SIZE_EXCEEDED: (m) => `Total upload size exceeds ${m.limit} bytes`
};
/** Resolves a message: field-level, then global, then the built-in default. */
function resolveMessage(meta, fieldMessages, globalMessages) {
	const pick = fieldMessages?.[meta.code] ?? globalMessages?.[meta.code];
	if (pick === void 0) return DEFAULTS[meta.code](meta);
	return typeof pick === "function" ? pick(meta) : pick;
}
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
/** Strips directory components and unsafe characters from a client-supplied filename. */
function sanitizeFilename(name) {
	const cleaned = name.replace(/^.*[/\\]/, "").trim().replace(CONTROL_CHARS, "").replace(/[<>:"|?*]/g, "_").replace(/^\.+/, "").slice(0, 200);
	return cleaned.length > 0 ? cleaned : "file";
}
/** Bytes needed for reliable magic-byte detection; smaller samples still detect many formats. */
const SNIFF_SAMPLE_SIZE = 4100;
/** Detects a MIME type from content, never from the client-supplied header. */
async function detectType(sample) {
	return (await fileTypeFromBuffer(sample))?.mime;
}
/** `types` may list exact MIME types or wildcards such as `"image/*"`. */
function matchesTypes(mime, types) {
	if (!types || types.length === 0) return true;
	if (mime === void 0) return false;
	return types.some((t) => t.endsWith("/*") ? mime.startsWith(t.slice(0, -1)) : mime === t);
}
function issueMeta(code, field, filename, extra) {
	return {
		code,
		field,
		filename,
		...extra
	};
}
function toIssue(meta, fieldMessages, globalMessages) {
	return {
		path: meta.field,
		code: meta.code,
		message: resolveMessage(meta, fieldMessages, globalMessages),
		meta
	};
}
/**
* Reads one file part to completion: accumulates in memory up to
* `memoryThreshold`, then spills to `dir`; cuts the stream mid-write when it
* exceeds the field's size limit, and sniffs the type from the leading bytes.
*/
function consumeFile(stream, dir, maxSize, memoryThreshold, types, onBytes) {
	return new Promise((resolve, reject) => {
		let size = 0;
		let sample = Buffer.alloc(0);
		let buffer = Buffer.alloc(0);
		let writeStream;
		let diskPath;
		let rejected;
		const spill = () => {
			diskPath = join(dir, randomUUID());
			writeStream = createWriteStream(diskPath);
			if (buffer && buffer.length > 0) writeStream.write(buffer);
			buffer = null;
		};
		stream.on("data", (chunk) => {
			if (rejected) return;
			size += chunk.length;
			if (sample.length < 4100) sample = Buffer.concat([sample, chunk]).subarray(0, SNIFF_SAMPLE_SIZE);
			if (size > maxSize) {
				rejected = {
					code: "FILE_TOO_LARGE",
					extra: {
						limit: maxSize,
						actual: size
					}
				};
				writeStream?.destroy();
				return;
			}
			if (!onBytes(chunk.length)) {
				rejected = { code: "TOTAL_SIZE_EXCEEDED" };
				writeStream?.destroy();
				return;
			}
			if (buffer !== null) {
				buffer = Buffer.concat([buffer, chunk]);
				if (buffer.length > memoryThreshold) spill();
			} else writeStream?.write(chunk);
		});
		stream.on("error", reject);
		stream.on("end", async () => {
			if (writeStream) await new Promise((res) => writeStream?.end(res));
			if (rejected) {
				if (diskPath) await unlink(diskPath).catch(() => {});
				resolve({
					size,
					rejected
				});
				return;
			}
			const mimeType = await detectType(sample);
			if (!matchesTypes(mimeType, types)) {
				if (diskPath) await unlink(diskPath).catch(() => {});
				resolve({
					size,
					rejected: {
						code: "FILE_TYPE_NOT_ALLOWED",
						extra: {
							detected: mimeType,
							allowed: types
						}
					}
				});
				return;
			}
			resolve({
				size,
				...diskPath === void 0 ? {} : { path: diskPath },
				...buffer === null ? {} : { buffer },
				...mimeType === void 0 ? {} : { mimeType }
			});
		});
	});
}
/** Builds an `UploadsParser` from resolved global options; registered with core via `setUploadsParser`. */
function createParser(options) {
	return async (ctx, spec) => {
		if (!(ctx.req.headers["content-type"] ?? "").toLowerCase().startsWith("multipart/form-data")) throw new BadRequest("Expected multipart/form-data for a route that declares .uploads()");
		const dir = join(options.tempDir, ctx.requestId);
		await mkdir(dir, { recursive: true });
		const bb = busboy({ headers: ctx.req.headers });
		const body = {};
		const counts = {};
		const outcomes = [];
		const created = [];
		let totalBytes = 0;
		let totalExceeded = false;
		const trackTotal = (n) => {
			totalBytes += n;
			if (totalBytes > options.maxTotalSize) totalExceeded = true;
			return !totalExceeded;
		};
		bb.on("field", (name, value) => {
			body[name] = value;
		});
		bb.on("file", (name, stream, info) => {
			const filename = sanitizeFilename(info.filename);
			const fieldSpec = spec[name];
			if (!fieldSpec) {
				stream.resume();
				outcomes.push(Promise.resolve({
					field: name,
					issue: {
						code: "UNEXPECTED_FILE",
						filename
					}
				}));
				return;
			}
			const maxCount = fieldSpec.maxCount ?? 1;
			counts[name] = (counts[name] ?? 0) + 1;
			if (counts[name] > maxCount) {
				stream.resume();
				outcomes.push(Promise.resolve({
					field: name,
					issue: {
						code: "TOO_MANY_FILES",
						filename,
						extra: { limit: maxCount }
					}
				}));
				return;
			}
			const maxSize = fieldSpec.maxSize === void 0 ? options.maxFileSize : parseBytes(fieldSpec.maxSize);
			const types = fieldSpec.types ?? options.types;
			outcomes.push(consumeFile(stream, dir, maxSize, options.memoryThreshold, types, trackTotal).then((result) => {
				if (result.rejected) return {
					field: name,
					issue: {
						...result.rejected,
						filename
					}
				};
				const file = new UploadedFileImpl({
					field: name,
					filename,
					mimeType: result.mimeType ?? "application/octet-stream",
					size: result.size,
					...result.path === void 0 ? {} : { path: result.path },
					...result.buffer === void 0 ? {} : { buffer: result.buffer }
				});
				created.push(file);
				return {
					field: name,
					file
				};
			}));
		});
		const finished = new Promise((resolve, reject) => {
			bb.on("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
			bb.on("close", resolve);
		});
		ctx.req.pipe(bb);
		try {
			await finished;
		} catch (error) {
			throw new BadRequest(`Malformed multipart request: ${error.message}`);
		}
		const settled = await Promise.all(outcomes);
		const cleanup = async () => {
			for (const file of created) if (!file.moved && !file.kept) await file.discard();
			await rmdir(dir).catch(() => {});
		};
		ctx.res.once("finish", () => void cleanup());
		ctx.res.once("close", () => void cleanup());
		if (totalExceeded) {
			const meta = issueMeta("TOTAL_SIZE_EXCEEDED", "", "", {
				limit: options.maxTotalSize,
				actual: totalBytes
			});
			throw validationError("uploads", [toIssue(meta, void 0, options.messages)]);
		}
		const issues = [];
		const uploads = {};
		for (const outcome of settled) {
			const fieldSpec = spec[outcome.field];
			if (outcome.issue) {
				const meta = issueMeta(outcome.issue.code, outcome.field, outcome.issue.filename, outcome.issue.extra);
				issues.push(toIssue(meta, fieldSpec?.messages, options.messages));
				continue;
			}
			if (!outcome.file) continue;
			if (fieldSpec?.maxCount !== void 0) {
				const list = uploads[outcome.field] ?? [];
				list.push(outcome.file);
				uploads[outcome.field] = list;
			} else uploads[outcome.field] = outcome.file;
		}
		for (const [name, fieldSpec] of Object.entries(spec)) {
			if (uploads[name] !== void 0 || (counts[name] ?? 0) > 0) continue;
			if (fieldSpec.optional) continue;
			const meta = issueMeta("FILE_REQUIRED", name, "");
			issues.push(toIssue(meta, fieldSpec.messages, options.messages));
		}
		if (issues.length > 0) throw validationError("uploads", issues);
		return {
			uploads,
			body
		};
	};
}
/** Removes subdirectories of `tempDir` whose modification time is older than `maxAgeMs`. Best-effort. */
async function sweepTempDir(tempDir, maxAgeMs, logger) {
	let entries;
	try {
		entries = await readdir(tempDir);
	} catch (error) {
		if (error.code === "ENOENT") return;
		logger.warn({
			err: error,
			tempDir
		}, "upload temp dir sweep failed to read directory");
		return;
	}
	const cutoff = Date.now() - maxAgeMs;
	await Promise.all(entries.map(async (entry) => {
		const full = join(tempDir, entry);
		try {
			const info = await stat(full);
			if (info.isDirectory() && info.mtimeMs < cutoff) await rm(full, {
				recursive: true,
				force: true
			});
		} catch (error) {
			logger.warn({
				err: error,
				path: full
			}, "upload temp dir sweep failed for entry");
		}
	}));
}
/** Config fragment for the primitive (env-representable) global options. */
const uploadConfig = {
	tempDir: env.string({ default: join(tmpdir(), "notio-uploads") }),
	maxFileSize: env.bytes({ default: "10mb" }),
	maxTotalSize: env.bytes({ default: "50mb" }),
	memoryThreshold: env.bytes({ default: "0" }),
	sweepAfter: env.duration({ default: "1h" })
};
/**
* Installs the upload module: resolves global options, sweeps stale temp
* directories from a previous run, and registers the parser that
* `.uploads()` routes need. Returns an inert Express handler for `app.use()`;
* registration happens as soon as this function runs.
*/
function uploads(options = {}) {
	const { types, messages, ...primitives } = options;
	const resolved = resolveConfig(uploadConfig, primitives, "uploads()");
	setUploadsParser(createParser({
		tempDir: resolved.tempDir,
		maxFileSize: resolved.maxFileSize,
		maxTotalSize: resolved.maxTotalSize,
		memoryThreshold: resolved.memoryThreshold,
		types,
		messages
	}));
	sweepTempDir(resolved.tempDir, resolved.sweepAfter, getRootLogger());
	return (_req, _res, next) => next();
}
//#endregion
export { SNIFF_SAMPLE_SIZE, UPLOAD_ISSUE_CODES, UploadedFileImpl, createParser, detectType, matchesTypes, resolveMessage, sanitizeFilename, sweepTempDir, uploadConfig, uploads };
