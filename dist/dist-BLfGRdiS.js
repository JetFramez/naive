import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { STATUS_CODES, createServer } from "node:http";
import express from "express";
import { parseCookie, stringifySetCookie } from "cookie";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pino } from "pino";
import { Keyv } from "keyv";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
//#region ../core/dist/index.js
/**
* Base class for every error notio sends to a client. The wire shape is always
* `{ code, message, details?, requestId }`.
*/
var HttpError = class extends Error {
	status;
	code;
	details;
	constructor(status, code, message, details) {
		super(message ?? STATUS_CODES[status] ?? "Error");
		this.name = new.target.name;
		this.status = status;
		this.code = code;
		this.details = details;
	}
};
/** A subclass factory: `class TeapotError extends defineError(418, "TEAPOT") {}`. */
function defineError(status, code) {
	return class extends HttpError {
		constructor(message, details) {
			super(status, code, message, details);
		}
	};
}
var BadRequest = class extends defineError(400, "BAD_REQUEST") {};
var Unauthorized = class extends defineError(401, "UNAUTHORIZED") {};
var Forbidden = class extends defineError(403, "FORBIDDEN") {};
var NotFound = class extends defineError(404, "NOT_FOUND") {};
var MethodNotAllowed = class extends defineError(405, "METHOD_NOT_ALLOWED") {};
var Conflict = class extends defineError(409, "CONFLICT") {};
var Gone = class extends defineError(410, "GONE") {};
var PayloadTooLarge = class extends defineError(413, "PAYLOAD_TOO_LARGE") {};
var Unprocessable = class extends defineError(422, "VALIDATION") {};
var TooManyRequests = class extends defineError(429, "RATE_LIMITED") {};
var Internal = class extends defineError(500, "INTERNAL") {};
var ServiceUnavailable = class extends defineError(503, "SERVICE_UNAVAILABLE") {};
function isHttpError(value) {
	return value instanceof HttpError;
}
let root;
let factory;
/** @internal Registers how the lazy root logger is built. */
function setRootFactory(fn) {
	factory = fn;
}
/** The process-wide root logger, created lazily with defaults on first use. */
function getRootLogger() {
	if (!root) {
		if (!factory) throw new Error("notio: no logger factory registered");
		root = factory();
	}
	return root;
}
/** @internal Replaces the root logger (used by `configureLogger` and `createApp`). */
function setRootLogger(logger) {
	root = logger;
}
const storage = new AsyncLocalStorage();
/** The ambient HTTP context, or `undefined` outside a request. */
function currentCtx() {
	const ctx = storage.getStore();
	return ctx?.kind === "http" ? ctx : void 0;
}
/** The ambient context of any kind (HTTP request, job, CLI), or `undefined`. */
function currentBaseCtx() {
	return storage.getStore();
}
/** The ambient HTTP context; throws when called outside a request. */
function requireCtx() {
	const ctx = currentCtx();
	if (!ctx) throw new Internal("requireCtx() called outside of a request");
	return ctx;
}
/** @internal Runs `fn` with `ctx` as the ambient context unless it already is. */
function runInCtx(ctx, fn) {
	return storage.getStore() === ctx ? fn() : storage.run(ctx, fn);
}
/**
* Runs `fn` under a context for work that is not an HTTP request (jobs, CLI,
* event listeners). `log` and `currentBaseCtx()` see it. Fields not supplied
* get defaults: a fresh `requestId`, `kind: "job"`, an empty `state`, and a
* root child logger carrying `requestId` and `kind`.
*/
function runWithCtx(partial, fn) {
	const requestId = partial.requestId ?? randomUUID();
	const kind = partial.kind ?? "job";
	const base = {
		requestId,
		kind,
		state: partial.state ?? {},
		log: partial.log ?? getRootLogger().child({
			requestId,
			kind
		}),
		bind(fields) {
			this.log = this.log.child(fields);
		}
	};
	return storage.run(base, () => fn(base));
}
/** Brand carried by every response descriptor returned from `ctx.json()` and friends. */
const RESPONSE = Symbol.for("notio.response");
const UNITS$1 = {
	ms: 1,
	s: 1e3,
	m: 6e4,
	h: 36e5,
	d: 864e5,
	w: 6048e5
};
const PATTERN$1 = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?\s*$/i;
/**
* Parses a duration into milliseconds. Numbers pass through; strings accept
* `ms`, `s`, `m`, `h`, `d`, `w` (`"5m"`, `"30d"`, `"1.5h"`). A bare number
* string is milliseconds.
*/
function parseDuration(value, name = "duration") {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid ${name}: ${value}`);
		return value;
	}
	const match = PATTERN$1.exec(value);
	if (!match) throw new TypeError(`Invalid ${name}: "${value}" (expected e.g. "5m", "30d", 1500)`);
	const unit = (match[2] ?? "ms").toLowerCase();
	return Math.round(Number(match[1]) * (UNITS$1[unit] ?? 1));
}
function sign(value, key) {
	return createHmac("sha256", key).update(value).digest("base64url");
}
var CookieJar = class {
	#ctx;
	#keys;
	#parsed;
	constructor(ctx, options = {}) {
		this.#ctx = ctx;
		const secret = options.secret;
		this.#keys = secret === void 0 ? [] : Array.isArray(secret) ? secret : [secret];
	}
	get(name) {
		return this.all()[name];
	}
	all() {
		if (!this.#parsed) {
			const parsed = parseCookie(this.#ctx.req.headers.cookie ?? "");
			const out = {};
			for (const [k, v] of Object.entries(parsed)) if (v !== void 0) out[k] = v;
			this.#parsed = out;
		}
		return this.#parsed;
	}
	set(name, value, options = {}) {
		const { maxAge, ...rest } = options;
		this.#ctx.res.append("Set-Cookie", stringifySetCookie({
			name,
			value,
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			secure: this.#ctx.req.secure,
			...rest,
			...maxAge === void 0 ? {} : { maxAge: Math.floor(parseDuration(maxAge, `cookie "${name}" maxAge`) / 1e3) }
		}));
		return this.#ctx;
	}
	delete(name, options = {}) {
		return this.set(name, "", {
			...options,
			expires: /* @__PURE__ */ new Date(0),
			maxAge: 0
		});
	}
	getSigned(name) {
		this.#requireSecret("getSigned");
		const raw = this.get(name);
		if (raw === void 0) return void 0;
		const dot = raw.lastIndexOf(".");
		if (dot <= 0) return void 0;
		const value = raw.slice(0, dot);
		const sig = Buffer.from(raw.slice(dot + 1));
		for (const key of this.#keys) {
			const expected = Buffer.from(sign(value, key));
			if (expected.length === sig.length && timingSafeEqual(expected, sig)) return value;
		}
	}
	setSigned(name, value, options) {
		const key = this.#requireSecret("setSigned");
		return this.set(name, `${value}.${sign(value, key)}`, options);
	}
	#requireSecret(method) {
		const key = this.#keys[0];
		if (key === void 0) throw new Internal(`ctx.cookies.${method}() needs a cookie secret: pass createApp({ cookies: { secret } })`);
		return key;
	}
};
var Headers = class {
	#ctx;
	/** Set by validation when the route declares a headers schema. */
	validated;
	constructor(ctx) {
		this.#ctx = ctx;
	}
	get(name) {
		const value = this.#ctx.req.headers[name.toLowerCase()];
		return Array.isArray(value) ? value.join(", ") : value;
	}
	has(name) {
		return this.#ctx.req.headers[name.toLowerCase()] !== void 0;
	}
	all() {
		return this.validated ?? this.#ctx.req.headers;
	}
	set(name, value) {
		this.#ctx.res.setHeader(name, value);
		return this.#ctx;
	}
	append(name, value) {
		this.#ctx.res.append(name, value);
		return this.#ctx;
	}
};
/**
* The runtime behind {@link Ctx}. Fields the interface exposes as readonly are
* mutable here so the router can install validated values.
*/
var RequestContext = class {
	kind = "http";
	req;
	res;
	requestId;
	method;
	path;
	state = {};
	headers;
	cookies;
	route = void 0;
	log;
	/** Status chosen with `ctx.status()`, applied to plain return values. */
	statusCode = void 0;
	/** Installed by the router when the route declared `.response(schema)`. */
	responseSchema = void 0;
	/** App-level hooks registered by the context middleware. */
	appHooks = {
		onRequest: [],
		onResponse: [],
		onError: []
	};
	/** The handler's return value, for app-level `onResponse`. */
	result = void 0;
	startedAt = Date.now();
	requestLogArmed = false;
	/** Installed by the upload module when the route declared `.uploads()`. */
	uploads = void 0;
	#url;
	#params;
	#query;
	#rawQuery;
	#body;
	constructor(req, res, options = {}) {
		this.req = req;
		this.res = res;
		this.method = req.method;
		this.path = (req.originalUrl ?? req.url).split("?")[0] ?? "/";
		const incoming = req.headers["x-request-id"];
		this.requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
		this.headers = new Headers(this);
		this.cookies = new CookieJar(this, { secret: options.cookieSecret });
		this.log = (options.logger ?? getRootLogger()).child({ requestId: this.requestId });
	}
	/**
	* Path params: the validated value once the route's params schema ran,
	* otherwise the live `req.params` (the context may predate routing).
	*/
	get params() {
		return this.#params ?? this.req.params;
	}
	set params(value) {
		this.#params = value;
	}
	/** Query: validated value, otherwise `req.query` normalised to strings and string arrays. */
	get query() {
		if (this.#query) return this.#query;
		const source = this.req.query;
		const cached = this.#rawQuery;
		if (cached && cached.source === source) return cached.value;
		const value = normaliseQuery(source);
		this.#rawQuery = {
			source,
			value
		};
		return value;
	}
	set query(value) {
		this.#query = value;
	}
	/** Body: validated value, otherwise whatever the body parser put on `req.body`. */
	get body() {
		return this.#body ? this.#body.value : this.req.body;
	}
	set body(value) {
		this.#body = { value };
	}
	get url() {
		this.#url ??= new URL(this.req.originalUrl ?? this.req.url, `${this.req.protocol}://${this.req.get("host") ?? "localhost"}`);
		return this.#url;
	}
	get ip() {
		return this.req.ip ?? "";
	}
	bearer() {
		const header = this.headers.get("authorization");
		if (!header) return void 0;
		const [scheme, token] = header.split(" ", 2);
		return scheme?.toLowerCase() === "bearer" && token ? token.trim() : void 0;
	}
	accepts(...types) {
		return this.req.accepts(types);
	}
	set(name, value) {
		this.headers.set(name, value);
		return this;
	}
	status(code) {
		this.statusCode = code;
		return this;
	}
	bind(fields) {
		this.log = this.log.child(fields);
	}
	json(data, init = {}) {
		return {
			[RESPONSE]: "json",
			data,
			...init
		};
	}
	text(body, init = {}) {
		return {
			[RESPONSE]: "text",
			body,
			...init
		};
	}
	redirect(url, status = 302) {
		return {
			[RESPONSE]: "redirect",
			url,
			status
		};
	}
	file(path, options = {}) {
		return {
			[RESPONSE]: "file",
			path,
			...options
		};
	}
	download(path, filename) {
		return filename === void 0 ? {
			[RESPONSE]: "download",
			path
		} : {
			[RESPONSE]: "download",
			path,
			filename
		};
	}
	stream(readable, options = {}) {
		return {
			[RESPONSE]: "stream",
			readable,
			...options
		};
	}
	empty(status = 204) {
		return {
			[RESPONSE]: "empty",
			status
		};
	}
	raw(write) {
		return {
			[RESPONSE]: "raw",
			write
		};
	}
};
function normaliseQuery(query) {
	const out = {};
	if (!query) return out;
	for (const [key, value] of Object.entries(query)) if (typeof value === "string") out[key] = value;
	else if (Array.isArray(value)) out[key] = value.map(String);
	else if (value !== void 0 && value !== null) out[key] = value;
	return out;
}
/** Creates the context for a request and stores it on `res.locals.ctx`. */
function createCtx(req, res, options) {
	const ctx = new RequestContext(req, res, options);
	res.locals.ctx = ctx;
	return ctx;
}
/** The context previously created for this response, if any. */
function ctxOf(res) {
	const ctx = res.locals.ctx;
	return ctx instanceof RequestContext ? ctx : void 0;
}
/** Returns the existing context or creates one. */
function ensureCtx(req, res, options) {
	return ctxOf(res) ?? createCtx(req, res, options);
}
function createAppHooks() {
	return {
		onRequest: [],
		onResponse: [],
		onError: []
	};
}
function list$1(value) {
	if (value === void 0) return [];
	return Array.isArray(value) ? [...value] : [value];
}
/** @internal Runs hooks in order; errors are logged and swallowed. */
async function runHooksSafely(ctx, hooks, args) {
	for (const hook of hooks) try {
		await hook(...args);
	} catch (error) {
		ctx.log.error({ err: error }, "hook threw");
	}
}
function onDone(ctx, cb) {
	const res = ctx.res;
	let fired = false;
	const once = () => {
		if (fired) return;
		fired = true;
		res.off("finish", once);
		res.off("close", once);
		cb();
	};
	res.once("finish", once);
	res.once("close", once);
}
/**
* The context middleware: creates `ctx`, makes it ambient through
* `AsyncLocalStorage`, registers app-level hooks, and writes the request log
* line. `createApp` installs it first; on a bare Express app use it (or
* `hooks()`) before routes. Safe to install more than once.
*/
function context(options = {}) {
	const onRequest = list$1(options.onRequest);
	const onResponse = list$1(options.onResponse);
	const onError = list$1(options.onError);
	const requestLog = options.requestLog ?? true;
	return (req, res, next) => {
		const ctx = ensureCtx(req, res, options);
		ctx.appHooks.onRequest.push(...onRequest);
		ctx.appHooks.onResponse.push(...onResponse);
		ctx.appHooks.onError.push(...onError);
		if (onResponse.length > 0) onDone(ctx, () => {
			runHooksSafely(ctx, onResponse, [ctx, ctx.result]);
		});
		if (requestLog !== false && !ctx.requestLogArmed) {
			ctx.requestLogArmed = true;
			const ignore = typeof requestLog === "object" ? requestLog.ignore : void 0;
			onDone(ctx, () => {
				if (ignore?.(ctx)) return;
				const fields = {
					method: ctx.method,
					path: ctx.path,
					route: ctx.route,
					status: res.statusCode,
					duration: Date.now() - ctx.startedAt
				};
				if (!res.writableFinished) fields.aborted = true;
				ctx.log.info(fields, "request");
			});
		}
		runInCtx(ctx, () => {
			if (onRequest.length === 0) {
				next();
				return;
			}
			(async () => {
				try {
					for (const hook of onRequest) await hook(ctx);
					next();
				} catch (error) {
					next(error);
				}
			})();
		});
	};
}
/**
* Registers app-level hooks on a bare Express app by installing the context
* middleware at this point. Call it before routes. `createApp` exposes the
* same hooks as `app.onRequest()`, `app.onResponse()` and `app.onError()`.
*/
function hooks(app, options) {
	app.use(context({
		...options,
		requestLog: false
	}));
}
/** Thrown internally when Express middleware calls `next("route")` or `next("router")`. */
var RouteSkip = class {
	target;
	constructor(target) {
		this.target = target;
	}
};
function isDescriptor(value) {
	return typeof value === "object" && value !== null && RESPONSE in value;
}
function responded(ctx) {
	return ctx.res.headersSent || ctx.res.writableEnded;
}
/** Waits for the response to finish or the connection to close. */
function onResponseDone(ctx, cb) {
	const res = ctx.res;
	if (res.writableEnded) {
		cb();
		return () => {};
	}
	const done = () => {
		res.off("finish", done);
		res.off("close", done);
		cb();
	};
	res.once("finish", done);
	res.once("close", done);
	return () => {
		res.off("finish", done);
		res.off("close", done);
	};
}
/** Wraps an Express `(req, res, next)` handler so it participates in the chain untouched. */
function expressStep(handler) {
	return (ctx, next) => new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = onResponseDone(ctx, () => {
			if (settled) return;
			settled = true;
			resolve();
		});
		const done = (err) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (err === "route" || err === "router") reject(new RouteSkip(err));
			else if (err) reject(err);
			else resolve(next());
		};
		try {
			const out = handler(ctx.req, ctx.res, done);
			if (out instanceof Promise) out.catch(done);
		} catch (err) {
			done(err);
		}
	});
}
/** Wraps an Express `(err, req, res, next)` handler: it sees errors thrown downstream. */
function expressErrorStep(handler) {
	return async (ctx, next) => {
		try {
			await next();
		} catch (error) {
			if (error instanceof RouteSkip) throw error;
			await new Promise((resolve, reject) => {
				let settled = false;
				const cleanup = onResponseDone(ctx, () => {
					if (settled) return;
					settled = true;
					resolve();
				});
				const done = (err) => {
					if (settled) return;
					settled = true;
					cleanup();
					if (err === "route" || err === "router") reject(new RouteSkip(err));
					else if (err) reject(err);
					else resolve();
				};
				try {
					const out = handler(error, ctx.req, ctx.res, done);
					if (out instanceof Promise) out.catch(done);
				} catch (err) {
					done(err);
				}
			});
		}
	};
}
function toStep(middleware) {
	if (middleware.length >= 4) return expressErrorStep(middleware);
	if (middleware.length === 3) return expressStep(middleware);
	return middleware;
}
/**
* Runs steps outer to inner. The last step is terminal: its return value is
* the result. A middleware that returns a descriptor without calling `next()`
* also produces the result. A middleware that neither responds, throws, calls
* `next()`, nor returns a descriptor is a bug and raises `Internal`.
*/
async function runChain(steps, ctx) {
	let produced = false;
	let value;
	const dispatch = async (index) => {
		const step = steps[index];
		if (!step) return;
		const last = index === steps.length - 1;
		let called = false;
		const next = () => {
			if (called) return Promise.reject(new Internal("next() called more than once"));
			called = true;
			return dispatch(index + 1);
		};
		const out = await step(ctx, next);
		if (last) {
			produced = true;
			value = out;
		} else if (!called) {
			if (isDescriptor(out)) {
				produced = true;
				value = out;
			} else if (!responded(ctx)) throw new Internal("middleware ended without responding or calling next()");
		}
	};
	await dispatch(0);
	return {
		produced,
		value
	};
}
const OCTET = "application/octet-stream";
function applyHeaders(res, headers) {
	if (!headers) return;
	for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
}
function defaultType(res, type) {
	if (!res.getHeader("content-type")) res.type(type);
}
function defaultStatus(ctx) {
	return ctx.statusCode ?? (ctx.method === "POST" ? 201 : 200);
}
async function pipeStream(ctx, readable) {
	try {
		await pipeline(readable, ctx.res);
	} catch (error) {
		if (!ctx.res.headersSent) throw error;
		ctx.log.warn({ err: error }, "stream ended early");
	}
}
function callback(res, run) {
	return new Promise((resolveP, reject) => {
		run((err) => {
			if (!err) return resolveP();
			if (res.headersSent) return resolveP();
			reject(err);
		});
	});
}
async function sendDescriptor(ctx, d) {
	const res = ctx.res;
	switch (d[RESPONSE]) {
		case "json":
			applyHeaders(res, d.headers);
			res.status(d.status ?? defaultStatus(ctx)).json(d.data);
			return;
		case "text":
			applyHeaders(res, d.headers);
			defaultType(res, "text/plain");
			res.status(d.status ?? ctx.statusCode ?? 200).send(d.body);
			return;
		case "redirect":
			res.redirect(d.status, d.url);
			return;
		case "file":
			applyHeaders(res, d.headers);
			if (d.type) res.type(d.type);
			if (d.status ?? ctx.statusCode) res.status(d.status ?? ctx.statusCode ?? 200);
			await callback(res, (cb) => res.sendFile(resolve(d.path), cb));
			return;
		case "download": {
			applyHeaders(res, d.headers);
			const path = resolve(d.path);
			await callback(res, (cb) => d.filename === void 0 ? res.download(path, cb) : res.download(path, d.filename, cb));
			return;
		}
		case "stream":
			applyHeaders(res, d.headers);
			defaultType(res, d.type ?? OCTET);
			res.status(d.status ?? ctx.statusCode ?? 200);
			await pipeStream(ctx, d.readable);
			return;
		case "empty":
			res.status(d.status).end();
			return;
		case "raw":
			await d.write(res);
			return;
	}
}
/**
* Turns a handler's return value into a response, following the conventions:
* string → text, undefined → 204, Buffer/Readable → bytes, descriptor → as
* described, anything else → JSON (201 for POST).
*/
async function sendResult(ctx, result) {
	const res = ctx.res;
	if (res.headersSent) {
		if (result !== void 0) ctx.log.warn({ route: ctx.route }, "handler wrote to ctx.res and also returned a value; the value was ignored");
		return;
	}
	if (isDescriptor(result)) return sendDescriptor(ctx, result);
	if (result === void 0) {
		res.status(ctx.statusCode ?? 204).end();
		return;
	}
	if (typeof result === "string") {
		defaultType(res, "text/plain");
		res.status(ctx.statusCode ?? 200).send(result);
		return;
	}
	if (Buffer.isBuffer(result)) {
		defaultType(res, OCTET);
		res.status(ctx.statusCode ?? 200).send(result);
		return;
	}
	if (result instanceof Readable) {
		defaultType(res, OCTET);
		res.status(ctx.statusCode ?? 200);
		await pipeStream(ctx, result);
		return;
	}
	res.status(defaultStatus(ctx)).json(result);
}
let parser;
/** @internal Called by the upload module's middleware. */
function setUploadsParser(fn) {
	parser = fn;
}
/** @internal Test-only reset. */
function clearUploadsParser() {
	parser = void 0;
}
function getUploadsParser() {
	return parser;
}
const UPLOAD_MODULE_INSTALL_MESSAGE = "declares .uploads() but the upload module is not installed. Install it and register it: import { uploads } from \"@jetframez/notio/upload\"; app.use(uploads());";
function toIssues(issues) {
	return issues.map((issue) => {
		const raw = issue;
		const code = typeof raw.code === "string" ? raw.code : typeof raw.type === "string" ? raw.type : "invalid";
		const path = (issue.path ?? []).map((seg) => String(typeof seg === "object" && seg !== null ? seg.key : seg)).join(".");
		return raw.expected === void 0 ? {
			path,
			code,
			message: issue.message
		} : {
			path,
			code,
			message: issue.message,
			meta: { expected: raw.expected }
		};
	});
}
async function runSchema(schema, value) {
	const result = await schema["~standard"].validate(value);
	if (result.issues) return {
		ok: false,
		issues: toIssues(result.issues)
	};
	return {
		ok: true,
		value: result.value
	};
}
function validationError(section, issues) {
	const details = {
		in: section,
		issues
	};
	return new Unprocessable(`Invalid ${section}`, details);
}
/** Wraps single string values in arrays for the top-level keys that failed. */
function arrayifyFailing(value, issues) {
	let changed = false;
	const next = { ...value };
	for (const issue of issues) {
		const key = issue.path;
		if (key && !key.includes(".") && typeof next[key] === "string") {
			next[key] = [next[key]];
			changed = true;
		}
	}
	return changed ? next : void 0;
}
/**
* Validates params, query, headers and body in that order, installing the
* transformed values on the context. Stops at the first failing section.
*/
async function validateRequest(ctx, schemas) {
	if (schemas.params) {
		const out = await runSchema(schemas.params, ctx.params);
		if (!out.ok) throw validationError("params", out.issues);
		ctx.params = out.value;
	}
	if (schemas.query) {
		let out = await runSchema(schemas.query, ctx.query);
		if (!out.ok) {
			const retry = arrayifyFailing(ctx.query, out.issues);
			if (retry) {
				const second = await runSchema(schemas.query, retry);
				if (second.ok) out = second;
			}
		}
		if (!out.ok) throw validationError("query", out.issues);
		ctx.query = out.value;
	}
	if (schemas.headers) {
		const out = await runSchema(schemas.headers, ctx.req.headers);
		if (!out.ok) throw validationError("headers", out.issues);
		ctx.headers.validated = out.value;
	}
	if (schemas.body) {
		const out = await runSchema(schemas.body, ctx.body);
		if (!out.ok) throw validationError("body", out.issues);
		ctx.body = out.value;
	}
}
/** Validates a handler's return value against `.response(schema)`; throws `Internal` on mismatch. */
async function validateResponse(schema, value) {
	const out = await runSchema(schema, value);
	if (!out.ok) throw new Internal("Response does not match the declared response schema", {
		in: "response",
		issues: out.issues
	});
}
/** Marks an error whose router-level `onError` hooks already ran. */
const ROUTER_HANDLED = Symbol.for("notio.error.routerHandled");
function markHandled(error) {
	if (typeof error === "object" && error !== null) Object.defineProperty(error, ROUTER_HANDLED, {
		value: true,
		enumerable: false
	});
}
function wasHandledByRouter(error) {
	return typeof error === "object" && error !== null && ROUTER_HANDLED in error;
}
async function runHooks(ctx, hooks, args, swallow) {
	for (const hook of hooks) try {
		await hook(...args);
	} catch (error) {
		if (!swallow) throw error;
		ctx.log.error({ err: error }, "hook threw");
	}
}
function shouldValidateResponses(options) {
	return options.validateResponses && process.env.NODE_ENV !== "production";
}
function routeHandler(route, options) {
	const { info, hooks } = route;
	if (info.uploads && !getUploadsParser()) throw new Error(`Route ${info.method} ${info.path} ${UPLOAD_MODULE_INSTALL_MESSAGE}`);
	const validation = async (ctx, next) => {
		await validateRequest(ctx, {
			...info.schemas.params ? { params: info.schemas.params } : {},
			...info.schemas.query ? { query: info.schemas.query } : {},
			...info.schemas.headers ? { headers: info.schemas.headers } : {}
		});
		if (info.uploads) {
			const parser = getUploadsParser();
			if (!parser) throw new Error(`Route ${info.method} ${info.path} ${UPLOAD_MODULE_INSTALL_MESSAGE}`);
			const parsed = await parser(ctx, info.uploads);
			ctx.uploads = parsed.uploads;
			ctx.body = parsed.body;
		}
		await validateRequest(ctx, info.schemas.body ? { body: info.schemas.body } : {});
		await next();
	};
	const terminal = (ctx) => info.handler(ctx);
	const steps = [
		...route.inherited.map(toStep),
		validation,
		...info.routeMiddleware.map(toStep),
		terminal
	];
	const routeLabel = `${info.method} ${info.path}`;
	const checkResponse = shouldValidateResponses(options) ? info.response : void 0;
	return (req, res, next) => {
		const ctx = ensureCtx(req, res);
		ctx.route = routeLabel;
		ctx.log = ctx.log.child({ route: routeLabel });
		ctx.responseSchema = info.response;
		runInCtx(ctx, async () => {
			let result;
			try {
				await runHooks(ctx, hooks.onRequest, [ctx], false);
				const chain = await runChain(steps, ctx);
				result = chain.value;
				ctx.result = result;
				if (checkResponse && chain.produced) {
					const candidate = isDescriptor(result) && result[RESPONSE] === "json" ? result.data : result;
					if (!isDescriptor(result) || result[RESPONSE] === "json") await validateResponse(checkResponse, candidate);
				}
				if (chain.produced) await sendResult(ctx, result);
				await runHooks(ctx, hooks.onResponse, [ctx, result], true);
			} catch (error) {
				if (error instanceof RouteSkip) {
					next(error.target);
					return;
				}
				await failRequest(ctx, hooks, error);
				next(error);
			}
		});
	};
}
/** Flags the error, then runs router hooks and app hooks, so the error handler does not repeat them. */
async function failRequest(ctx, hooks, error) {
	markHandled(error);
	await runHooks(ctx, hooks.onError, [ctx, error], true);
	await runHooks(ctx, ctx.appHooks.onError, [ctx, error], true);
}
function staticHandler(entry) {
	const { maxAge, spa, ...rest } = entry.options;
	const serve = express.static(entry.dir, {
		...rest,
		...maxAge === void 0 ? {} : { maxAge: parseDuration(maxAge, "static maxAge") }
	});
	const fallback = spa ? (ctx, next) => {
		if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") return next();
		if (!ctx.req.accepts("html")) return next();
		return new Promise((resolveP, reject) => {
			ctx.res.sendFile(resolve(entry.dir, "index.html"), (err) => err ? reject(err) : resolveP());
		});
	} : (_ctx, next) => next();
	return passthrough([
		...entry.middleware.map(toStep),
		toStep(serve),
		fallback
	], entry.hooks);
}
function redirectHandler(entry) {
	const terminal = (ctx) => ctx.redirect(entry.to, entry.status);
	return passthrough([...entry.middleware.map(toStep), terminal], entry.hooks, true);
}
/** A chain that falls through to Express `next()` when nothing responded. */
function passthrough(steps, hooks, terminal = false) {
	return (req, res, next) => {
		const ctx = ensureCtx(req, res);
		runInCtx(ctx, async () => {
			try {
				await runHooks(ctx, hooks.onRequest, [ctx], false);
				const chain = await runChain(steps, ctx);
				if (chain.produced && (terminal || chain.value !== void 0)) await sendResult(ctx, chain.value);
				if (!res.headersSent && !res.writableEnded) {
					next();
					return;
				}
				await runHooks(ctx, hooks.onResponse, [ctx, chain.value], true);
			} catch (error) {
				if (error instanceof RouteSkip) {
					next(error.target);
					return;
				}
				await failRequest(ctx, hooks, error);
				next(error);
			}
		});
	};
}
/** Builds an `express.Router()` from the collected entries, in registration order. */
function compile(entries, options) {
	const router = express.Router();
	for (const entry of entries) switch (entry.kind) {
		case "route":
			router[entry.route.info.method.toLowerCase()](entry.route.info.path, routeHandler(entry.route, options));
			break;
		case "static":
			router.use(entry.static.path, staticHandler(entry.static));
			break;
		case "redirect": router.get(entry.redirect.from, redirectHandler(entry.redirect));
	}
	return router;
}
function codeForStatus(status) {
	return (STATUS_CODES[status] ?? "Error").replace(/[^A-Za-z0-9 ]/g, "").trim().replace(/\s+/g, "_").toUpperCase();
}
function numericStatus(error) {
	for (const key of ["status", "statusCode"]) {
		const value = error[key];
		if (typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599) return value;
	}
}
function looksLikeIssues(value) {
	return Array.isArray(value) && value.length > 0 && value.every((issue) => typeof issue === "object" && issue !== null && typeof issue.message === "string");
}
function fallbackMessage(error) {
	if (error instanceof Error) return error.message || error.name;
	return typeof error === "string" ? error : "Unknown error";
}
/**
* Turns anything thrown into a status, code, message and details.
*
* 1. `HttpError` → as declared.
* 2. An error carrying Standard Schema / Zod `issues` → 422 `VALIDATION`.
* 3. body-parser errors → 400 malformed body, 413 over the limit.
* 4. Any error with a numeric `status`/`statusCode` (http-errors convention) →
*    that status; the message is used only when `err.expose` is true.
* 5. Everything else → 500 `INTERNAL`; `expose` decides whether the real
*    message is shown.
*
* The error's name is never part of the result.
*/
function classifyError(error, expose) {
	if (isHttpError(error)) return error.details === void 0 ? {
		status: error.status,
		code: error.code,
		message: error.message
	} : {
		status: error.status,
		code: error.code,
		message: error.message,
		details: error.details
	};
	if (typeof error === "object" && error !== null) {
		const err = error;
		if (looksLikeIssues(err.issues)) return {
			status: 422,
			code: "VALIDATION",
			message: "Validation failed",
			details: { issues: toIssues(err.issues) }
		};
		if (err.type === "entity.parse.failed") return {
			status: 400,
			code: "BAD_REQUEST",
			message: "Malformed request body"
		};
		if (err.type === "entity.too.large") return {
			status: 413,
			code: "PAYLOAD_TOO_LARGE",
			message: "Request body too large",
			details: {
				limit: err.limit,
				length: err.length
			}
		};
		const status = numericStatus(err);
		if (status !== void 0) {
			const message = err.expose === true && typeof err.message === "string" && err.message ? err.message : STATUS_CODES[status] ?? "Error";
			return {
				status,
				code: codeForStatus(status),
				message
			};
		}
	}
	return {
		status: 500,
		code: "INTERNAL",
		message: expose ? fallbackMessage(error) : "Internal Server Error"
	};
}
function defaultExpose() {
	return process.env.NODE_ENV !== "production";
}
/** The default wire shape. `stack` is present only for exposed 5xx errors. */
function defaultEnvelope(mapped, ctx, stack) {
	return {
		code: mapped.code,
		message: mapped.message,
		...mapped.details === void 0 ? {} : { details: mapped.details },
		requestId: ctx.requestId,
		...stack === void 0 ? {} : { stack }
	};
}
/**
* Express error handler that renders every error in the unified shape. Register
* it last on a bare Express app; `createApp` installs it for you and
* `app.errors()` configures it.
*/
function errorHandler(options = {}) {
	const expose = options.expose ?? defaultExpose();
	return (error, req, res, next) => {
		if (res.headersSent) {
			next(error);
			return;
		}
		const ctx = ensureCtx(req, res, { logger: options.logger });
		if (!wasHandledByRouter(error) && ctx.appHooks.onError.length > 0) {
			runHooksSafely(ctx, ctx.appHooks.onError, [ctx, error]).then(() => render(error));
			return;
		}
		render(error);
		function render(error) {
			let mapped;
			let source = error;
			try {
				const custom = options.map?.(error, ctx);
				if (isHttpError(custom)) mapped = classifyError(custom, expose);
				else if (custom) mapped = custom;
			} catch (mapError) {
				source = mapError;
			}
			mapped ??= classifyError(source, expose);
			if (mapped.status >= 500) ctx.log.error({
				err: source,
				status: mapped.status,
				code: mapped.code,
				route: ctx.route
			}, mapped.message);
			const stack = expose && mapped.status >= 500 && source instanceof Error ? source.stack : void 0;
			const body = options.format ? options.format(mapped, ctx) : defaultEnvelope(mapped, ctx, stack);
			res.status(mapped.status);
			if (body === void 0 || body === null) res.end();
			else if (typeof body === "string") res.send(body);
			else res.json(body);
		}
	};
}
/**
* Terminal handler that turns an unmatched request into `NotFound`, so the
* error handler renders it. `createApp` installs it after everything else.
*/
function notFound() {
	return (req, _res, next) => {
		next(new NotFound(`No route for ${req.method} ${req.originalUrl.split("?")[0]}`));
	};
}
const LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal"
];
/** Keys redacted by default wherever they appear at the top level or one level down. */
const DEFAULT_REDACT = [
	"authorization",
	"cookie",
	"[\"set-cookie\"]",
	"password",
	"*.authorization",
	"*.cookie",
	"*[\"set-cookie\"]",
	"*.password",
	"*.token"
];
function isLevel(value) {
	return LOG_LEVELS.includes(value);
}
function resolveLevel(level) {
	const chosen = level ?? process.env.LOG_LEVEL ?? "info";
	if (!isLevel(chosen)) throw new Error(`Invalid log level "${chosen}" (expected one of ${LOG_LEVELS.join(", ")})`);
	return chosen;
}
/** Adapts a pino instance to the {@link Logger} interface. `raw` is the pino logger itself. */
var PinoLogger = class PinoLogger {
	raw;
	trace;
	debug;
	info;
	warn;
	error;
	fatal;
	constructor(raw) {
		this.raw = raw;
		const bind = (level) => (first, ...rest) => {
			raw[level](first, ...rest);
		};
		this.trace = bind("trace");
		this.debug = bind("debug");
		this.info = bind("info");
		this.warn = bind("warn");
		this.error = bind("error");
		this.fatal = bind("fatal");
	}
	get level() {
		return this.raw.level;
	}
	set level(level) {
		this.raw.level = level;
	}
	child(fields) {
		return new PinoLogger(this.raw.child(fields));
	}
	isLevelEnabled(level) {
		return this.raw.isLevelEnabled(level);
	}
};
/** Creates a standalone logger. Most code should use `createApp({ logger })` or `configureLogger()`. */
function createLogger(options = {}) {
	const level = resolveLevel(options.level);
	const pretty = options.pretty ?? (process.env.NODE_ENV !== "production" && process.stdout.isTTY === true);
	const pinoOptions = {
		level,
		redact: {
			paths: [...options.redact ?? DEFAULT_REDACT],
			censor: "[Redacted]"
		},
		...options.base === void 0 ? {} : { base: options.base },
		...options.name === void 0 ? {} : { name: options.name },
		...pretty ? { transport: {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "SYS:standard"
			}
		} } : {}
	};
	return new PinoLogger(pretty || !options.destination ? pino(pinoOptions) : pino(pinoOptions, options.destination));
}
/**
* Builds the root logger for scripts and tests that do not go through
* `createApp`. Returns the new root.
*/
function configureLogger(options = {}) {
	const logger = createLogger(options);
	setRootLogger(logger);
	return logger;
}
setRootFactory(() => createLogger());
function finished(ctx) {
	const res = ctx.res;
	if (res.writableEnded) return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			res.off("finish", done);
			res.off("close", done);
			resolve();
		};
		res.once("finish", done);
		res.once("close", done);
	});
}
/**
* Adapts a `(ctx, next)` middleware to a standalone Express handler for use
* outside a router (app level). `await next()` resolves when the response has
* finished, so code after it observes the outcome but can no longer change
* headers. Express middleware passes through untouched.
*/
function toExpress(middleware) {
	if (middleware.length >= 3) return middleware;
	const mw = middleware;
	return (req, res, next) => {
		const ctx = ensureCtx(req, res);
		let called = false;
		const proceed = () => {
			if (called) return Promise.reject(new Internal("next() called more than once"));
			called = true;
			next();
			return finished(ctx);
		};
		runInCtx(ctx, () => {
			(async () => {
				try {
					const out = await mw(ctx, proceed);
					if (called) return;
					if (isDescriptor(out)) await sendResult(ctx, out);
					else if (!res.headersSent && !res.writableEnded) throw new Internal("middleware ended without responding or calling next()");
				} catch (error) {
					if (!called) next(error);
					else ctx.log.error({ err: error }, "middleware threw after next()");
				}
			})();
		});
	};
}
const PARAM_PATTERN = /[:*]([A-Za-z0-9_]+)/g;
/** Runtime twin of {@link PathParams}: the parameter names in a path, in order. */
function paramNames(path) {
	const names = [];
	for (const match of path.matchAll(PARAM_PATTERN)) {
		const name = match[1];
		if (name !== void 0) names.push(name);
	}
	return names;
}
/** Joins a prefix and a path, collapsing duplicate slashes and trailing slashes. */
function joinPath(prefix, path) {
	const joined = `${prefix}${path}`.replace(/\/{2,}/g, "/");
	if (joined.length > 1 && joined.endsWith("/")) return joined.slice(0, -1);
	return joined === "" ? "/" : joined;
}
/**
* Runtime behind {@link RouteBuilder}. Every method mutates one definition and
* returns the same instance; the static types narrow along the chain.
*/
var RouteBuilderImpl = class {
	#route;
	#register;
	constructor(route, register) {
		this.#route = route;
		this.#register = register;
	}
	params(schema) {
		this.#route.schemas.params = schema;
		return this;
	}
	query(schema) {
		this.#route.schemas.query = schema;
		return this;
	}
	headers(schema) {
		this.#route.schemas.headers = schema;
		return this;
	}
	body(schema) {
		this.#route.schemas.body = schema;
		return this;
	}
	uploads(spec) {
		this.#route.uploads = spec;
		return this;
	}
	use(...middleware) {
		this.#route.middleware.push(...middleware);
		return this;
	}
	summary(text) {
		this.#route.summary = text;
		return this;
	}
	tags(...tags) {
		this.#route.tags.push(...tags);
		return this;
	}
	response(statusOrSchema, schema) {
		if (typeof statusOrSchema === "number") {
			if (schema) this.#route.responses.push({
				status: statusOrSchema,
				schema
			});
		} else {
			this.#route.response = statusOrSchema;
			this.#route.responses.push({
				status: this.#route.method === "POST" ? 201 : 200,
				schema: statusOrSchema
			});
		}
		return this;
	}
	errors(...classes) {
		this.#route.errors.push(...classes);
		return this;
	}
	deprecated() {
		this.#route.deprecated = true;
		return this;
	}
	hidden() {
		this.#route.hidden = true;
		return this;
	}
	handle(handler) {
		const r = this.#route;
		const info = {
			method: r.method,
			path: r.path,
			params: paramNames(r.path),
			schemas: { ...r.schemas },
			uploads: r.uploads,
			middleware: [...r.inherited, ...r.middleware],
			routeMiddleware: [...r.middleware],
			handler,
			response: r.response,
			summary: r.summary,
			tags: [...r.tags],
			responses: [...r.responses],
			errors: [...r.errors],
			deprecated: r.deprecated,
			hidden: r.hidden
		};
		this.#register(info, r.inherited);
		return info;
	}
};
function mergeHooks(outer, inner) {
	return {
		onRequest: [...outer.onRequest, ...inner.onRequest],
		onResponse: [...outer.onResponse, ...inner.onResponse],
		onError: [...outer.onError, ...inner.onError]
	};
}
const NO_HOOKS = {
	onRequest: [],
	onResponse: [],
	onError: []
};
/**
* A chainable, typed router. `Prefix` is the full path prefix (including any
* parent group prefixes); `Adds` is what router-level middleware has put on `ctx`.
*
* A router is itself Express middleware: `app.use(router)` works on a bare
* Express app, and `router.express()` returns the compiled `express.Router`.
*
* @example
* const orders = new Router("/orders").use(auth.require());
* orders.get("/:id").handle((ctx) => ctx.params.id);
*/
var Router = class Router {
	constructor(prefix, options = {}) {
		const self = function router(req, res, next) {
			self.express()(req, res, next);
		};
		Object.setPrototypeOf(self, new.target.prototype);
		const state = {
			options: { validateResponses: options.validateResponses ?? true },
			middleware: [],
			entries: [],
			hooks: {
				onRequest: [],
				onResponse: [],
				onError: []
			},
			compiled: void 0,
			version: 0,
			compiledVersion: -1
		};
		Object.defineProperty(self, "prefix", {
			value: prefix ?? "",
			enumerable: true
		});
		Object.defineProperty(self, "st", { value: state });
		return self;
	}
	use(...middleware) {
		this.st.middleware.push(...middleware);
		return this;
	}
	get(path) {
		return this.route("GET", path);
	}
	post(path) {
		return this.route("POST", path);
	}
	put(path) {
		return this.route("PUT", path);
	}
	patch(path) {
		return this.route("PATCH", path);
	}
	delete(path) {
		return this.route("DELETE", path);
	}
	head(path) {
		return this.route("HEAD", path);
	}
	options(path) {
		return this.route("OPTIONS", path);
	}
	route(method, path) {
		return new RouteBuilderImpl({
			method,
			path: joinPath(this.prefix, path),
			schemas: {},
			uploads: void 0,
			inherited: [...this.st.middleware],
			middleware: [],
			summary: void 0,
			tags: [],
			response: void 0,
			responses: [],
			errors: [],
			deprecated: false,
			hidden: false
		}, (info, inherited) => {
			this.st.entries.push({
				kind: "route",
				info,
				inherited
			});
			this.st.version++;
		});
	}
	group(prefix, middlewareOrDefine, maybeDefine) {
		const middleware = Array.isArray(middlewareOrDefine) ? middlewareOrDefine : [];
		const define = typeof middlewareOrDefine === "function" ? middlewareOrDefine : maybeDefine ?? (() => {});
		const child = new Router(joinPath(this.prefix, prefix), this.st.options);
		child.st.middleware.push(...this.st.middleware, ...middleware);
		this.st.entries.push({
			kind: "group",
			router: child
		});
		this.st.version++;
		define(child);
		return this;
	}
	/** Mounts a router defined elsewhere under `path`. The mounted router keeps its own prefix. */
	mount(path, router) {
		this.st.entries.push({
			kind: "mount",
			path,
			router,
			middleware: [...this.st.middleware]
		});
		this.st.version++;
		return this;
	}
	/** Serves a directory with `express.static`, behind this router's prefix and middleware. */
	static(path, dir, options = {}) {
		this.st.entries.push({
			kind: "static",
			info: {
				path: joinPath(this.prefix, path),
				dir,
				options,
				middleware: [...this.st.middleware]
			}
		});
		this.st.version++;
		return this;
	}
	redirect(from, to, status = 302) {
		this.st.entries.push({
			kind: "redirect",
			info: {
				from: joinPath(this.prefix, from),
				to,
				status,
				middleware: [...this.st.middleware]
			}
		});
		this.st.version++;
		return this;
	}
	onRequest(hook) {
		this.st.hooks.onRequest.push(hook);
		return this;
	}
	onResponse(hook) {
		this.st.hooks.onResponse.push(hook);
		return this;
	}
	onError(hook) {
		this.st.hooks.onError.push(hook);
		return this;
	}
	hooks() {
		return this.st.hooks;
	}
	/** Every route under this router, including groups and mounts, with full paths. */
	routes() {
		return this.entries().flatMap((e) => e.kind === "route" ? [e.route.info] : []);
	}
	/** Every static mount under this router, including groups and mounts. */
	statics() {
		return this.entries().flatMap((e) => e.kind === "static" ? [stripHooks(e.static)] : []);
	}
	redirects() {
		return this.entries().flatMap((e) => e.kind === "redirect" ? [stripHooks(e.redirect)] : []);
	}
	/**
	* The compiled `express.Router`. Rebuilt lazily when routes were added since
	* the last call, so registering after mounting still works.
	*/
	express() {
		const st = this.st;
		if (!st.compiled || st.compiledVersion !== this.version()) {
			st.compiled = compile(this.entries(), st.options);
			st.compiledVersion = this.version();
		}
		return st.compiled;
	}
	/** @internal Sum of this router's and every descendant's registration counters. */
	version() {
		let total = this.st.version;
		for (const e of this.st.entries) if (e.kind === "group" || e.kind === "mount") total += e.router.version();
		return total;
	}
	/** @internal */
	entries(inherited = {
		path: "",
		middleware: [],
		hooks: NO_HOOKS
	}) {
		const hooks = mergeHooks(inherited.hooks, this.st.hooks);
		const out = [];
		for (const e of this.st.entries) switch (e.kind) {
			case "route": {
				const route = {
					info: {
						...e.info,
						path: joinPath(inherited.path, e.info.path),
						middleware: [...inherited.middleware, ...e.info.middleware]
					},
					inherited: [...inherited.middleware, ...e.inherited],
					hooks
				};
				out.push({
					kind: "route",
					route
				});
				break;
			}
			case "static": {
				const s = {
					...e.info,
					path: joinPath(inherited.path, e.info.path),
					middleware: [...inherited.middleware, ...e.info.middleware],
					hooks
				};
				out.push({
					kind: "static",
					static: s
				});
				break;
			}
			case "redirect": {
				const r = {
					...e.info,
					from: joinPath(inherited.path, e.info.from),
					middleware: [...inherited.middleware, ...e.info.middleware],
					hooks
				};
				out.push({
					kind: "redirect",
					redirect: r
				});
				break;
			}
			case "group":
				out.push(...e.router.entries({
					path: inherited.path,
					middleware: inherited.middleware,
					hooks
				}));
				break;
			case "mount": out.push(...e.router.entries({
				path: joinPath(inherited.path, joinPath(this.prefix, e.path)),
				middleware: [...inherited.middleware, ...e.middleware],
				hooks
			}));
		}
		return out;
	}
};
function stripHooks(entry) {
	const { hooks: _hooks, ...rest } = entry;
	return rest;
}
const UNITS = {
	b: 1,
	kb: 1024,
	mb: 1024 ** 2,
	gb: 1024 ** 3,
	tb: 1024 ** 4
};
const PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/i;
/**
* Parses a byte size. Numbers pass through; strings accept `b`, `kb`, `mb`,
* `gb`, `tb` (`"10mb"`, `"1.5gb"`). A bare number string is bytes.
*/
function parseBytes(value, name = "size") {
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid ${name}: ${value}`);
		return value;
	}
	const match = PATTERN.exec(value);
	if (!match) throw new TypeError(`Invalid ${name}: "${value}" (expected e.g. "10mb", 1024)`);
	const unit = (match[2] ?? "b").toLowerCase();
	return Math.round(Number(match[1]) * (UNITS[unit] ?? 1));
}
function isLogger(value) {
	return typeof value === "object" && value !== null && typeof value.child === "function";
}
/**
* The application: a real Express instance plus the pieces `createApp` wires
* in the right order at `listen()`.
*/
var App = class {
	/** The raw Express instance. Registering on it directly bypasses notio's ordering. */
	express;
	logger;
	/** The HTTP server, once listening. */
	server = void 0;
	#options;
	#entries = [];
	#hooks = {
		onRequest: [],
		onResponse: [],
		onError: [],
		onStart: [],
		onReady: [],
		onShutdown: []
	};
	#errorOptions = {};
	#built = false;
	#ready = false;
	#closing = false;
	#listening = false;
	#signalHandler;
	constructor(options = {}) {
		this.#options = options;
		this.express = express();
		const loggerOption = options.logger;
		this.logger = isLogger(loggerOption) ? loggerOption : createLogger(loggerOption);
		setRootLogger(this.logger);
	}
	use(...middleware) {
		this.#entries.push({
			kind: "use",
			middleware: [...middleware]
		});
		return this;
	}
	mount(first, ...rest) {
		if (typeof first === "string") for (const router of rest) this.#entries.push({
			kind: "router",
			router: new Router().mount(first, router)
		});
		else for (const router of [first, ...rest]) this.#entries.push({
			kind: "router",
			router
		});
		return this;
	}
	static(path, dir, options) {
		this.#entries.push({
			kind: "router",
			router: new Router().static(path, dir, options)
		});
		return this;
	}
	redirect(from, to, status) {
		this.#entries.push({
			kind: "router",
			router: new Router().redirect(from, to, status)
		});
		return this;
	}
	/** Configures the built-in error handler. It is always registered last; never add it yourself. */
	errors(options) {
		this.#errorOptions = {
			...this.#errorOptions,
			...options
		};
		return this;
	}
	onRequest(hook) {
		this.#hooks.onRequest.push(hook);
		return this;
	}
	onResponse(hook) {
		this.#hooks.onResponse.push(hook);
		return this;
	}
	onError(hook) {
		this.#hooks.onError.push(hook);
		return this;
	}
	/** Runs before the server binds; async and awaited in order. */
	onStart(hook) {
		this.#hooks.onStart.push(hook);
		return this;
	}
	/** Runs after the server is bound; `/ready` turns 200 afterwards. */
	onReady(hook) {
		this.#hooks.onReady.push(hook);
		return this;
	}
	/** Runs after in-flight requests drained, before `close()` resolves. */
	onShutdown(hook) {
		this.#hooks.onShutdown.push(hook);
		return this;
	}
	/** Route metadata across every mounted router, with mount prefixes applied. */
	routes() {
		return this.#entries.flatMap((e) => e.kind === "router" ? e.router.routes() : []);
	}
	get ready() {
		return this.#ready;
	}
	/**
	* Wires everything onto the Express instance in the enforced order. Called
	* by `listen()`; call it yourself only to use `app.express` with another server.
	*/
	build() {
		if (this.#built) return this.express;
		this.#built = true;
		const ex = this.express;
		const opts = this.#options;
		const health = opts.health === false ? void 0 : {
			path: "/health",
			ready: "/ready",
			...opts.health
		};
		const quiet = new Set([health?.path, health?.ready].filter((p) => typeof p === "string"));
		ex.use(context({
			logger: this.logger,
			cookieSecret: opts.cookies?.secret,
			onRequest: this.#hooks.onRequest,
			onResponse: this.#hooks.onResponse,
			onError: this.#hooks.onError,
			requestLog: { ignore: (ctx) => quiet.has(ctx.path) }
		}));
		const body = opts.body ?? {};
		if (body.json !== false) {
			const { limit, ...rest } = body.json ?? {};
			ex.use(express.json({
				limit: parseBytes(limit ?? "1mb", "body.json.limit"),
				...rest
			}));
		}
		if (body.urlencoded) {
			const { limit, ...rest } = body.urlencoded;
			ex.use(express.urlencoded({
				extended: true,
				limit: parseBytes(limit ?? "1mb", "body.urlencoded.limit"),
				...rest
			}));
		}
		if (health?.path) ex.get(health.path, (_req, res) => {
			res.status(200).json({ status: "ok" });
		});
		if (health?.ready) ex.get(health.ready, (_req, res) => {
			if (this.#closing) res.status(503).json({ status: "shutting-down" });
			else if (this.#ready) res.status(200).json({ status: "ready" });
			else res.status(503).json({ status: "starting" });
		});
		for (const entry of this.#entries) if (entry.kind === "use") ex.use(...entry.middleware.map(toExpress));
		else ex.use(entry.router.express());
		ex.use(notFound());
		ex.use(errorHandler({
			logger: this.logger,
			...this.#errorOptions
		}));
		return ex;
	}
	async listen(port, hostOrCb, maybeCb) {
		if (this.#listening) throw new Error("listen() was already called");
		this.#listening = true;
		const host = typeof hostOrCb === "string" ? hostOrCb : void 0;
		const callback = typeof hostOrCb === "function" ? hostOrCb : maybeCb;
		const chosenPort = port ?? Number(process.env.PORT ?? 3e3);
		this.build();
		for (const hook of this.#hooks.onStart) await hook();
		const server = createServer(this.express);
		this.server = server;
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			const onListening = () => {
				server.off("error", reject);
				resolve();
			};
			if (host === void 0) server.listen(chosenPort, onListening);
			else server.listen(chosenPort, host, onListening);
		});
		this.#installSignals();
		const address = server.address();
		const boundPort = typeof address === "object" && address ? address.port : chosenPort;
		if (this.#startupLogs) this.logger.info({ port: boundPort }, `listening on port ${boundPort}`);
		for (const hook of this.#hooks.onReady) await hook();
		this.#ready = true;
		callback?.();
		return server;
	}
	/**
	* Stops accepting connections, drains in-flight requests within the
	* shutdown deadline, runs `onShutdown` hooks, and resolves. Idempotent.
	*/
	async close() {
		if (this.#closing) return this.#closePromise ?? Promise.resolve();
		this.#closing = true;
		this.#ready = false;
		this.#closePromise = this.#close();
		return this.#closePromise;
	}
	#closePromise;
	async #close() {
		this.#removeSignals();
		const server = this.server;
		if (server?.listening) {
			if (this.#startupLogs) this.logger.info("shutting down");
			const deadline = parseDuration(this.#options.shutdown?.deadline ?? "10s", "shutdown.deadline");
			await new Promise((resolve) => {
				const timer = setTimeout(() => {
					this.logger.warn({ deadline }, "shutdown deadline reached; closing open connections");
					server.closeAllConnections();
				}, deadline);
				server.close(() => {
					clearTimeout(timer);
					resolve();
				});
				server.closeIdleConnections();
			});
		}
		for (const hook of this.#hooks.onShutdown) try {
			await hook();
		} catch (error) {
			this.logger.error({ err: error }, "onShutdown hook threw");
		}
		if (this.#startupLogs && server) this.logger.info("closed");
	}
	get #startupLogs() {
		const logger = this.#options.logger;
		return isLogger(logger) ? true : logger?.startup ?? true;
	}
	#installSignals() {
		if (this.#options.shutdown?.signals === false) return;
		const handler = () => {
			this.close().then(() => process.exit(0), () => process.exit(1));
		};
		this.#signalHandler = handler;
		process.once("SIGTERM", handler);
		process.once("SIGINT", handler);
	}
	#removeSignals() {
		if (!this.#signalHandler) return;
		process.off("SIGTERM", this.#signalHandler);
		process.off("SIGINT", this.#signalHandler);
		this.#signalHandler = void 0;
	}
};
/** Creates an application. Everything is wired in the right order when `listen()` runs. */
function createApp(options = {}) {
	return new App(options);
}
const TAG_PREFIX = "~tag:";
function ttlMs(ttl, fallback) {
	return ttl === void 0 ? fallback : parseDuration(ttl, "cache ttl");
}
/**
* Creates a cache on Keyv. Memory by default; pass a store such as
* `await redisStore(url)` for Redis.
*/
function createCache(options = {}) {
	const keyv = new Keyv({
		...options.store ? { store: options.store } : {},
		namespace: options.prefix ?? "notio"
	});
	const defaultTtl = ttlMs(options.ttl, void 0);
	const inFlight = /* @__PURE__ */ new Map();
	const tagKeys = async (tag) => await keyv.get(TAG_PREFIX + tag) ?? [];
	const associate = async (tags, key) => {
		for (const tag of tags) {
			const keys = await tagKeys(tag);
			if (!keys.includes(key)) await keyv.set(TAG_PREFIX + tag, [...keys, key]);
		}
	};
	const scope = (tags) => ({
		get: (key) => keyv.get(key),
		async set(key, value, opts = {}) {
			await keyv.set(key, value, ttlMs(opts.ttl, defaultTtl));
			if (tags.length > 0) await associate(tags, key);
		},
		delete: (key) => keyv.delete(key),
		has: (key) => keyv.has(key),
		async remember(key, ttl, compute) {
			const hit = await keyv.get(key);
			if (hit !== void 0) return hit;
			const pending = inFlight.get(key);
			if (pending) return pending;
			const promise = (async () => {
				try {
					const value = await compute();
					await keyv.set(key, value, ttlMs(ttl, defaultTtl));
					if (tags.length > 0) await associate(tags, key);
					return value;
				} finally {
					inFlight.delete(key);
				}
			})();
			inFlight.set(key, promise);
			return promise;
		}
	});
	const cache = {
		...scope([]),
		keyv,
		clear: () => keyv.clear(),
		tags(...tags) {
			return {
				...scope(tags),
				async flush() {
					for (const tag of tags) {
						for (const key of await tagKeys(tag)) await keyv.delete(key);
						await keyv.delete(TAG_PREFIX + tag);
					}
				}
			};
		},
		close: () => keyv.disconnect()
	};
	options.app?.onShutdown(() => cache.close());
	return cache;
}
/**
* A Redis store for {@link createCache}. Requires the optional `@keyv/redis`
* package, imported lazily.
*/
async function redisStore(url, options) {
	let mod;
	try {
		mod = await import("@keyv/redis");
	} catch {
		throw new Error("Redis cache store requires the optional package \"@keyv/redis\": pnpm add @keyv/redis");
	}
	return new mod.default(url, options);
}
/** Thrown at boot with every configuration problem listed. */
var ConfigError = class extends Error {
	issues;
	constructor(issues, heading = "Invalid configuration") {
		const lines = issues.map((i) => `  - ${i.path}${i.env ? ` (${i.env})` : ""}: ${i.message}`);
		super(`${heading}:\n${lines.join("\n")}`);
		this.name = "ConfigError";
		this.issues = issues;
	}
};
const REDACT_KEY = /secret|password|token|key/i;
function isSchema(value) {
	return typeof value === "object" && value !== null && "~standard" in value;
}
/** `database.url` → `DATABASE_URL`, `upload.maxFileSize` → `UPLOAD_MAX_FILE_SIZE`. */
function envName(path) {
	return path.map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()).join("_");
}
function getPath(source, path) {
	let current = source;
	for (const key of path) {
		if (typeof current !== "object" || current === null) return void 0;
		current = current[key];
	}
	return current;
}
function deepFreeze(value) {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const inner of Object.values(value)) deepFreeze(inner);
	}
	return value;
}
function redact(value, key) {
	if (key !== void 0 && REDACT_KEY.test(key) && value !== void 0 && value !== null) return "[Redacted]";
	if (Array.isArray(value)) return value.map((v) => redact(v));
	if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
	return value;
}
/**
* Walks a shape, resolving every leaf through `lookup` and validating it.
* Returns the resolved object or throws {@link ConfigError} listing every problem.
*/
function resolveShape(shape, lookup, heading) {
	const issues = [];
	const walk = (node, path) => {
		const out = {};
		for (const [key, entry] of Object.entries(node)) {
			const here = [...path, key];
			if (isSchema(entry)) {
				const { value, env } = lookup(here);
				const result = entry["~standard"].validate(value);
				if (result instanceof Promise) {
					issues.push({
						path: here.join("."),
						message: "async schemas are not supported in config"
					});
					continue;
				}
				if (result.issues) for (const issue of result.issues) {
					const suffix = issue.path?.length ? ` (${issue.path.map((p) => String(typeof p === "object" ? p.key : p)).join(".")})` : "";
					issues.push({
						path: here.join("."),
						...env === void 0 ? {} : { env },
						message: `${issue.message}${suffix}`
					});
				}
				else out[key] = result.value;
			} else out[key] = walk(entry, here);
		}
		return out;
	};
	const resolved = walk(shape, []);
	if (issues.length > 0) throw new ConfigError(issues, heading);
	return resolved;
}
/**
* Applies a shape to a plain object of values: defaults filled in, every
* problem reported together. Module factories use it so that
* `uploads()`, `uploads({ maxFileSize: "50mb" })` and `uploads(config.upload)`
* are all valid.
*/
function resolveConfig(shape, values, name = "options") {
	return resolveShape(shape, (path) => ({ value: getPath(values, path) }), `Invalid ${name}`);
}
function loadFiles(cwd, envName) {
	const names = [
		".env",
		`.env.${envName}`,
		".env.local",
		`.env.${envName}.local`
	];
	let merged = {};
	for (const name of names) {
		const file = resolve(cwd, name);
		if (!existsSync(file)) continue;
		merged = {
			...merged,
			...parse(readFileSync(file, "utf8"))
		};
	}
	return merged;
}
/**
* Resolves configuration at boot from, in order of precedence: `overrides`,
* process env, `.env.<env>.local`, `.env.local`, `.env.<env>`, `.env`, then
* schema defaults. `.env` files are read only outside production. Env
* variable names follow the path: `database.url` → `DATABASE_URL`.
*
* Every problem is reported in one {@link ConfigError}. The result is frozen.
*/
function defineConfig(shape, options = {}) {
	const processEnv = options.processEnv ?? process.env;
	const envLabel = options.env ?? processEnv.NODE_ENV ?? "development";
	const files = options.files ?? envLabel !== "production" ? loadFiles(options.cwd ?? process.cwd(), envLabel) : {};
	const overrides = options.overrides;
	const resolved = resolveShape(shape, (path) => {
		const override = getPath(overrides, path);
		if (override !== void 0) return { value: override };
		const name = envName(path);
		const fromEnv = processEnv[name];
		if (fromEnv !== void 0) return {
			value: fromEnv,
			env: name
		};
		return {
			value: files[name],
			env: name
		};
	}, "Invalid configuration");
	Object.defineProperty(resolved, "$print", {
		value: () => redact(structuredClone(resolved)),
		enumerable: false
	});
	return deepFreeze(resolved);
}
const issue = (message) => ({ message });
function isIssue(value) {
	return typeof value === "object" && value !== null && "message" in value && Object.keys(value).length === 1;
}
function leaf(kind, parse, options = {}) {
	const { default: defaultValue, optional = false } = options;
	const validate = (value) => {
		if (value === void 0 || value === "") {
			if (defaultValue !== void 0) return { value: defaultValue };
			if (optional) return { value: void 0 };
			return { issues: [issue("required")] };
		}
		const out = parse(value);
		return isIssue(out) ? { issues: [out] } : { value: out };
	};
	return { "~standard": {
		version: 1,
		vendor: "notio",
		validate,
		kind,
		defaultValue,
		optional,
		types: void 0
	} };
}
const BOOL_TRUE = /* @__PURE__ */ new Set([
	"true",
	"1",
	"yes",
	"on"
]);
const BOOL_FALSE = /* @__PURE__ */ new Set([
	"false",
	"0",
	"no",
	"off"
]);
function string(options) {
	return leaf("string", (v) => typeof v === "string" ? v : issue("expected a string"), options);
}
function number(options) {
	return leaf("number", (v) => {
		const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
		return Number.isFinite(n) ? n : issue(`expected a number, got "${String(v)}"`);
	}, options);
}
function integer(options) {
	return leaf("integer", (v) => {
		const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
		return Number.isInteger(n) ? n : issue(`expected an integer, got "${String(v)}"`);
	}, options);
}
function port(options) {
	return leaf("port", (v) => {
		const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
		return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : issue(`expected a port (0-65535), got "${String(v)}"`);
	}, options);
}
function boolean(options) {
	return leaf("boolean", (v) => {
		if (typeof v === "boolean") return v;
		const s = String(v).trim().toLowerCase();
		if (BOOL_TRUE.has(s)) return true;
		if (BOOL_FALSE.has(s)) return false;
		return issue(`expected a boolean (true/false/1/0/yes/no/on/off), got "${String(v)}"`);
	}, options);
}
/** A duration; strings such as `"30s"` become milliseconds. */
function duration(options) {
	const resolved = options?.default === void 0 ? void 0 : parseDuration(options.default);
	return leaf("duration", (v) => {
		try {
			return typeof v === "string" || typeof v === "number" ? parseDuration(v) : issue("expected a duration");
		} catch (error) {
			return issue(error.message);
		}
	}, {
		...options,
		default: resolved
	});
}
/** A byte size; strings such as `"10mb"` become bytes. */
function bytes(options) {
	const resolved = options?.default === void 0 ? void 0 : parseBytes(options.default);
	return leaf("bytes", (v) => {
		try {
			return typeof v === "string" || typeof v === "number" ? parseBytes(v) : issue("expected a size");
		} catch (error) {
			return issue(error.message);
		}
	}, {
		...options,
		default: resolved
	});
}
function url(options) {
	return leaf("url", (v) => {
		if (typeof v !== "string") return issue("expected a URL");
		try {
			new URL(v);
			return v;
		} catch {
			return issue(`expected a URL, got "${v}"`);
		}
	}, options);
}
function enumeration(values, options) {
	return leaf("enum", (v) => typeof v === "string" && values.includes(v) ? v : issue(`expected one of ${values.join(", ")}, got "${String(v)}"`), options);
}
/** A comma-separated list; arrays pass through. Empty items are dropped. */
function list(options) {
	return leaf("list", (v) => {
		if (Array.isArray(v)) return v.map(String);
		if (typeof v !== "string") return issue("expected a comma-separated list");
		return v.split(",").map((s) => s.trim()).filter(Boolean);
	}, options);
}
/**
* Leaf schemas for configuration. Every value accepts the environment's raw
* string and the typed value alike. Use them in `defineConfig` shapes and in
* module option fragments; any other Standard Schema works too.
*/
const env = {
	string,
	number,
	integer,
	port,
	boolean,
	duration,
	bytes,
	url,
	enum: enumeration,
	list
};
function target() {
	return currentBaseCtx()?.log ?? getRootLogger();
}
const level = (name) => (first, ...rest) => {
	target()[name](first, ...rest);
};
/**
* A logger that resolves at call time: inside a request (or `runWithCtx`) it
* is `ctx.log`, with the request id and bound fields; elsewhere it is the root
* logger. One import works in handlers, services and scripts alike.
*/
const log = {
	get level() {
		return target().level;
	},
	set level(value) {
		target().level = value;
	},
	trace: level("trace"),
	debug: level("debug"),
	info: level("info"),
	warn: level("warn"),
	error: level("error"),
	fatal: level("fatal"),
	child: (fields) => target().child(fields),
	isLevelEnabled: (lvl) => target().isLevelEnabled(lvl)
};
function matcher(pattern) {
	if (!pattern.includes("*")) return (name) => name === pattern;
	const source = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
	const regex = new RegExp(`^${source}$`);
	return (name) => regex.test(name);
}
function schemasOf(input) {
	if (typeof input !== "object" || input === null) return {};
	const out = {};
	for (const [key, value] of Object.entries(input)) if (typeof value === "object" && value !== null && "~standard" in value) out[key] = value;
	return out;
}
function createEvents(input = {}) {
	const options = typeof input === "object" && input !== null && ("schemas" in input || "validate" in input) ? input : { schemas: schemasOf(input) };
	const schemas = options.schemas ?? {};
	const validate = options.validate ?? process.env.NODE_ENV !== "production";
	const subscriptions = [];
	const errorListeners = [];
	const checkPayload = async (name, payload) => {
		const schema = schemas[name];
		if (!validate || !schema) return payload;
		const result = await schema["~standard"].validate(payload);
		if (result.issues) throw new Internal(`Invalid payload for event "${name}"`, {
			event: name,
			issues: toIssues(result.issues)
		});
		return result.value;
	};
	const report = async (failure) => {
		log.error({
			err: failure.error,
			event: failure.name,
			eventId: failure.id
		}, "event listener threw");
		for (const listener of errorListeners) try {
			await listener(failure);
		} catch (error) {
			log.error({
				err: error,
				event: failure.name
			}, "event error listener threw");
		}
	};
	const run = (subs, name, payload) => {
		const meta = {
			name,
			id: randomUUID(),
			emittedAt: /* @__PURE__ */ new Date()
		};
		const ctx = currentBaseCtx();
		return subs.map((sub) => {
			const invoke = () => Promise.resolve().then(() => sub.listener(payload, meta));
			return (ctx ? runInCtx(ctx, invoke) : invoke()).catch((error) => {
				throw Object.assign(new ListenerFailure(error), {
					meta,
					listener: sub.original
				});
			});
		});
	};
	const subscribe = (pattern, listener, original) => {
		const sub = {
			pattern,
			test: matcher(pattern),
			listener,
			original
		};
		subscriptions.push(sub);
		return () => {
			const index = subscriptions.indexOf(sub);
			if (index >= 0) subscriptions.splice(index, 1);
		};
	};
	return {
		async emit(name, payload) {
			const value = await checkPayload(name, payload);
			const subs = subscriptions.filter((s) => s.test(name));
			for (const promise of run(subs, name, value)) promise.catch((failure) => {
				report({
					...failure.meta,
					error: failure.error,
					listener: failure.listener
				});
			});
		},
		async emitAndWait(name, payload) {
			const value = await checkPayload(name, payload);
			const subs = subscriptions.filter((s) => s.test(name));
			const errors = (await Promise.allSettled(run(subs, name, value))).filter((s) => s.status === "rejected").map((s) => s.reason.error);
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, `${errors.length} listeners for "${name}" threw`);
		},
		on(pattern, listener) {
			return subscribe(pattern, listener, listener);
		},
		once(pattern, listener) {
			const wrapper = (payload, meta) => {
				off();
				return listener(payload, meta);
			};
			const off = subscribe(pattern, wrapper, listener);
			return off;
		},
		off(pattern, listener) {
			for (let i = subscriptions.length - 1; i >= 0; i--) {
				const sub = subscriptions[i];
				if (sub && sub.pattern === pattern && sub.original === listener) subscriptions.splice(i, 1);
			}
		},
		onError(listener) {
			errorListeners.push(listener);
			return () => {
				const index = errorListeners.indexOf(listener);
				if (index >= 0) errorListeners.splice(index, 1);
			};
		}
	};
}
var ListenerFailure = class {
	error;
	constructor(error) {
		this.error = error;
	}
};
/**
* One-line checks: continues when `predicate` is truthy, otherwise throws the
* error produced by `error`.
*
* @example
* router.use(guard((ctx) => ctx.user.role === "admin", () => new Forbidden()));
*/
function guard(predicate, error) {
	return async (ctx, next) => {
		if (!await predicate(ctx)) throw error(ctx);
		await next();
	};
}
const UPLOAD_ISSUE_CODES = [
	"FILE_TOO_LARGE",
	"FILE_TYPE_NOT_ALLOWED",
	"TOO_MANY_FILES",
	"FILE_REQUIRED",
	"UNEXPECTED_FILE",
	"TOTAL_SIZE_EXCEEDED"
];
//#endregion
export { log as $, createApp as A, defineConfig as B, UPLOAD_MODULE_INSTALL_MESSAGE as C, clearUploadsParser as D, classifyError as E, createLogger as F, errorHandler as G, ensureCtx as H, ctxOf as I, guard as J, getRootLogger as K, currentBaseCtx as L, createCache as M, createCtx as N, configureLogger as O, createEvents as P, joinPath as Q, currentCtx as R, UPLOAD_ISSUE_CODES as S, Unprocessable as T, env as U, defineError as V, envName as W, isDescriptor as X, hooks as Y, isHttpError as Z, RequestContext as _, DEFAULT_REDACT as a, redisStore as at, ServiceUnavailable as b, HttpError as c, runSchema as ct, MethodNotAllowed as d, toExpress as dt, markHandled as et, NotFound as f, toIssues as ft, ROUTER_HANDLED as g, RESPONSE as h, Conflict as i, parseDuration as it, createAppHooks as j, context as k, Internal as l, runWithCtx as lt, PinoLogger as m, wasHandledByRouter as mt, BadRequest as n, paramNames as nt, Forbidden as o, requireCtx as ot, PayloadTooLarge as p, validationError as pt, getUploadsParser as q, ConfigError as r, parseBytes as rt, Gone as s, resolveConfig as st, App as t, notFound as tt, LOG_LEVELS as u, setUploadsParser as ut, RouteSkip as v, Unauthorized as w, TooManyRequests as x, Router as y, defaultEnvelope as z };
