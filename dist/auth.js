import { R as currentCtx, it as parseDuration, l as Internal, o as Forbidden, w as Unauthorized } from "./dist-BLfGRdiS.js";
import { createHash, randomBytes, scrypt as scrypt$1, timingSafeEqual } from "node:crypto";
import * as jose from "jose";
//#region ../auth/dist/index.js
/**
* Checks that `adapter` implements every method the configured strategies
* (and always-available capabilities) need. Throws one `Error` listing every
* problem, so a missing adapter method fails at `createAuth()`, not at the
* first request that needs it.
*/
function checkAdapter(adapter, requirements) {
	const missing = [];
	for (const req of requirements) {
		const absent = req.methods.filter((m) => typeof adapter[m] !== "function");
		if (absent.length > 0) missing.push(`  - ${req.source}: missing ${absent.join(", ")}`);
	}
	if (missing.length > 0) throw new Error(`createAuth(): the adapter is missing required methods:\n${missing.join("\n")}`);
}
/** A random, URL-safe opaque token. Never stored directly; only its hash is. */
function randomToken(bytes = 32) {
	return randomBytes(bytes).toString("base64url");
}
/** The form an opaque token or session cookie value takes in storage. */
function hashToken(token) {
	return createHash("sha256").update(token).digest("hex");
}
/** Sessions roll forward at most this often, regardless of how many requests arrive. */
const ROLL_THROTTLE_MS = 6e4;
/**
* Extends a session's expiry when it is due (rolling, throttled to one write
* per minute), capped by `absoluteMs` from the session's `createdAt` when the
* adapter reports one.
*/
async function rollSession(adapter, tokenHash, session, ttlMs, absoluteMs) {
	const now = Date.now();
	if (now - (session.rotatedAt?.getTime() ?? 0) < 6e4) return;
	let expiresAt = now + ttlMs;
	if (absoluteMs !== void 0 && session.createdAt) expiresAt = Math.min(expiresAt, session.createdAt.getTime() + absoluteMs);
	if (expiresAt <= session.expiresAt.getTime()) return;
	await adapter.updateSession(tokenHash, {
		expiresAt: new Date(expiresAt),
		rotatedAt: new Date(now)
	});
}
/** The initial expiry for a new session/token, bounded by `absolute` when given. */
function initialExpiry(ttlMs, absoluteMs) {
	const now = Date.now();
	return new Date(absoluteMs === void 0 ? now + ttlMs : now + Math.min(ttlMs, absoluteMs));
}
/**
* Double-submit-cookie CSRF protection for cookie sessions. Issues a token
* cookie on any request that lacks one, and requires state-changing requests
* to echo it back in a header.
*/
function csrf(options = {}) {
	const cookieName = options.cookie ?? "csrf";
	const headerName = options.header ?? "x-csrf-token";
	const safe = new Set((options.safeMethods ?? [
		"GET",
		"HEAD",
		"OPTIONS"
	]).map((m) => m.toUpperCase()));
	return async (ctx, next) => {
		let token = ctx.cookies.get(cookieName);
		if (!token) {
			token = randomToken(16);
			ctx.cookies.set(cookieName, token, {
				httpOnly: false,
				sameSite: "strict"
			});
		}
		if (!safe.has(ctx.method.toUpperCase())) {
			const provided = ctx.headers.get(headerName);
			if (!provided || provided !== token) throw new Forbidden("Invalid or missing CSRF token");
		}
		await next();
	};
}
function scryptAsync(password, salt, keyLength, options) {
	return new Promise((resolve, reject) => {
		scrypt$1(password, salt, keyLength, options, (err, derivedKey) => {
			if (err) reject(err);
			else resolve(derivedKey);
		});
	});
}
const DEFAULTS = {
	cost: 16384,
	keyLength: 64,
	saltLength: 16
};
/**
* The default password hasher: Node's built-in `crypto.scrypt`, no native
* dependency. Encodes as `scrypt$<cost>$<saltHex>$<hashHex>`.
*/
function scrypt(options = {}) {
	const { cost, keyLength, saltLength } = {
		...DEFAULTS,
		...options
	};
	return {
		name: "scrypt",
		async hash(password) {
			const salt = randomBytes(saltLength);
			const derived = await scryptAsync(password, salt, keyLength, { N: cost });
			return `scrypt$${cost}$${salt.toString("hex")}$${derived.toString("hex")}`;
		},
		async verify(hash, password) {
			const parts = hash.split("$");
			if (parts.length !== 4 || parts[0] !== "scrypt") return false;
			const usedCost = Number(parts[1]);
			const salt = parts[2];
			const expectedHex = parts[3];
			if (!Number.isInteger(usedCost) || !salt || !expectedHex) return false;
			try {
				const expected = Buffer.from(expectedHex, "hex");
				const derived = await scryptAsync(password, Buffer.from(salt, "hex"), expected.length, { N: usedCost });
				return derived.length === expected.length && timingSafeEqual(derived, expected);
			} catch {
				return false;
			}
		}
	};
}
/** Marks a middleware produced by `auth.require()`, for tools (like the OpenAPI module) that need to see it. */
const AUTH_REQUIREMENT = Symbol.for("notio.auth.requirement");
function getAuthRequirement(middleware) {
	if (typeof middleware !== "function") return void 0;
	return middleware[AUTH_REQUIREMENT];
}
function findByKind(strategies, kind) {
	return Object.values(strategies).find((s) => s.kind === kind);
}
function findLoginStrategy(strategies) {
	return Object.values(strategies).find((s) => typeof s.login === "function");
}
function findLogoutStrategy(strategies) {
	return Object.values(strategies).find((s) => typeof s.logout === "function");
}
/**
* Builds the auth surface: strategies, sessions, JWTs, opaque tokens with
* refresh rotation, and password hashing. Every configured strategy's
* adapter requirements are checked here, at boot, not on first use.
*/
function createAuth(config) {
	const { adapter, strategies } = config;
	const hasher = config.hash ?? scrypt();
	if (!strategies[config.default]) throw new Error(`createAuth(): default strategy "${config.default}" is not in "strategies"`);
	checkAdapter(adapter, [{
		source: "auth.verifyPassword()",
		methods: ["findUserByEmail"]
	}, ...Object.entries(strategies).map(([name, strategy]) => ({
		source: `strategies.${name}`,
		methods: strategy.requiredAdapterMethods
	}))]);
	const deps = {
		adapter,
		hasher
	};
	const jwtStrategy = findByKind(strategies, "jwt");
	const opaqueStrategy = findByKind(strategies, "opaque");
	const extendedAdapter = adapter;
	async function verifySessionFamily(payload) {
		if (!extendedAdapter.findSessionsByFamily) throw new Internal("auth.require(..., { verifySession: true }) needs the adapter to implement \"findSessionsByFamily(familyId)\"");
		if (typeof payload.fid !== "string") return false;
		return (await extendedAdapter.findSessionsByFamily(payload.fid)).some((s) => s.expiresAt.getTime() > Date.now());
	}
	function require(...args) {
		const trailing = args.length > 0 && typeof args[args.length - 1] === "object" ? args.pop() : void 0;
		const names = args.length > 0 ? args : [config.default];
		for (const name of names) if (!strategies[name]) throw new Error(`auth.require(): unknown strategy "${name}"`);
		if (trailing?.verifySession) {
			for (const name of names) if (strategies[name]?.kind !== "jwt") throw new Error(`auth.require(): { verifySession: true } only applies to a "jwt" strategy (got "${name}")`);
		}
		const middleware = async (ctx, next) => {
			for (const name of names) {
				const strategy = strategies[name];
				const outcome = await strategy.authenticate(ctx, deps);
				if (!outcome.ok) continue;
				if (trailing?.verifySession) {
					const raw = ctx.bearer();
					if (!await verifySessionFamily(raw ? await strategy.verify(raw).catch(() => ({})) : {})) continue;
				}
				ctx.user = outcome.user;
				await next();
				return;
			}
			throw new Unauthorized();
		};
		Object.defineProperty(middleware, AUTH_REQUIREMENT, {
			value: { strategies: names },
			enumerable: false
		});
		return middleware;
	}
	function optional(options = {}) {
		return async (ctx, next) => {
			const outcome = await strategies[config.default].authenticate(ctx, deps);
			if (outcome.ok) ctx.user = outcome.user;
			else if (outcome.presented && options.rejectInvalid) throw new Unauthorized();
			await next();
		};
	}
	async function verifyPassword(email, password) {
		const record = await adapter.findUserByEmail(email);
		const ok = await hasher.verify(record?.passwordHash ?? await hasher.hash(""), password);
		if (!record || !ok) throw new Unauthorized("Invalid email or password");
		const { passwordHash: _passwordHash, ...user } = record;
		return user;
	}
	async function login(ctx, user) {
		const strategy = findLoginStrategy(strategies);
		if (!strategy?.login) throw new Error("auth.login(): no configured strategy implements login() (cookieSession(), or custom() with a login hook)");
		await strategy.login(ctx, user, deps);
	}
	async function logout(ctx) {
		const strategy = findLogoutStrategy(strategies);
		if (!strategy?.logout) throw new Error("auth.logout(): no configured strategy implements logout() (cookieSession(), or custom() with a logout hook)");
		await strategy.logout(ctx, deps);
	}
	async function logoutEverywhere(userId) {
		await adapter.deleteSessionsByUser(userId);
	}
	async function issueToken(user, options = {}) {
		if (!jwtStrategy) throw new Error("auth.issueToken(): no jwt() strategy is configured");
		const ttlMs = options.ttl === void 0 ? void 0 : parseDuration(options.ttl, "issueToken ttl");
		return jwtStrategy.sign({ sub: user.id }, ttlMs);
	}
	async function issueTokens(user) {
		if (!jwtStrategy) throw new Error("auth.issueTokens(): no jwt() strategy is configured");
		if (!opaqueStrategy) throw new Error("auth.issueTokens(): no opaque() strategy is configured");
		const familyId = randomToken();
		const { refreshToken } = await mintRefreshToken(user.id, familyId);
		return {
			accessToken: await jwtStrategy.sign({
				sub: user.id,
				fid: familyId
			}),
			refreshToken,
			expiresIn: Math.round(jwtStrategy.ttlMs / 1e3)
		};
	}
	async function mintRefreshToken(userId, familyId) {
		const strategy = opaqueStrategy;
		const refreshToken = randomToken();
		const expiresAt = initialExpiry(strategy.ttlMs, strategy.absoluteMs);
		await adapter.createSession({
			tokenHash: hashToken(refreshToken),
			userId,
			familyId,
			expiresAt
		});
		return { refreshToken };
	}
	const GRACE_MS = 3e4;
	/**
	* The pair minted at each rotation, keyed by the *old* token's hash, so a
	* client that presents an already-rotated token again inside the grace
	* window gets back the identical pair rather than a fresh one (the brief
	* requires "the same new pair", not just "a valid one"). The adapter has
	* nowhere to store this, so it lives in process memory: it only needs to
	* survive `GRACE_MS`, and losing it after a restart just means the next
	* replay inside the (now moot) grace window is treated as reuse instead,
	* which is the safe direction to fail in.
	*/
	const rotationLog = /* @__PURE__ */ new Map();
	function sweepRotationLog() {
		const cutoff = Date.now() - GRACE_MS;
		for (const [key, entry] of rotationLog) if (entry.mintedAt < cutoff) rotationLog.delete(key);
	}
	async function refresh(refreshToken) {
		if (!jwtStrategy) throw new Error("auth.refresh(): no jwt() strategy is configured");
		if (!opaqueStrategy) throw new Error("auth.refresh(): no opaque() strategy is configured");
		sweepRotationLog();
		const tokenHash = hashToken(refreshToken);
		const session = await adapter.findSession(tokenHash);
		if (!session) throw new Unauthorized("Invalid refresh token");
		if (session.rotatedAt) {
			const age = Date.now() - session.rotatedAt.getTime();
			const replay = rotationLog.get(tokenHash);
			if (age <= GRACE_MS && replay) return replay.result;
			await adapter.deleteSessionsByFamily(session.familyId);
			throw new Unauthorized("Refresh token already used; session revoked");
		}
		if (session.expiresAt.getTime() <= Date.now()) {
			await adapter.deleteSession(tokenHash);
			throw new Unauthorized("Refresh token expired");
		}
		const user = await adapter.findUserById(session.userId);
		if (!user) throw new Unauthorized("Invalid refresh token");
		await adapter.updateSession(tokenHash, { rotatedAt: /* @__PURE__ */ new Date() });
		const { refreshToken: nextRefreshToken } = await mintRefreshToken(user.id, session.familyId);
		const result = {
			accessToken: await jwtStrategy.sign({
				sub: user.id,
				fid: session.familyId
			}),
			refreshToken: nextRefreshToken,
			expiresIn: Math.round(jwtStrategy.ttlMs / 1e3)
		};
		rotationLog.set(tokenHash, {
			result,
			mintedAt: Date.now()
		});
		return result;
	}
	return {
		require,
		optional,
		hashPassword: (password) => hasher.hash(password),
		verifyPassword,
		login,
		logout,
		logoutEverywhere,
		issueToken,
		issueTokens,
		refresh,
		csrf
	};
}
let mod;
async function load() {
	if (mod) return mod;
	try {
		mod = await import("@node-rs/argon2");
	} catch {
		throw new Error("Argon2 password hashing requires the optional package \"@node-rs/argon2\": pnpm add @node-rs/argon2");
	}
	return mod;
}
/**
* Argon2id password hashing via the optional `@node-rs/argon2` native
* package, imported lazily. Falls back to a clear install message when the
* package is missing.
*/
function argon2(options = {}) {
	return {
		name: "argon2",
		async hash(password) {
			const { hash } = await load();
			return hash(password, options);
		},
		async verify(hashed, password) {
			const { verify } = await load();
			try {
				return await verify(hashed, password);
			} catch {
				return false;
			}
		}
	};
}
/** The authenticated user for the current request, via ALS. `undefined` outside a request or if unauthenticated. */
function currentUser() {
	return currentCtx()?.user;
}
/** Like {@link currentUser}, but throws `Unauthorized` when there is none. */
function requireUser() {
	const user = currentUser();
	if (user === void 0) throw new Unauthorized("Authentication required");
	return user;
}
function absent() {
	return {
		ok: false,
		presented: false
	};
}
function invalid() {
	return {
		ok: false,
		presented: true
	};
}
function authenticated(user) {
	return {
		ok: true,
		user
	};
}
/**
* Auth on a caller-supplied key, verified by your own lookup (a database of
* API keys, a third-party check, anything). notio does not store or hash
* anything for this strategy; `verify` owns that entirely.
*/
function apiKey(options) {
	if (!options.header && !options.query) throw new Error("apiKey(): pass \"header\" or \"query\"");
	if (options.header && options.query) throw new Error("apiKey(): pass \"header\" or \"query\", not both");
	return {
		kind: "apiKey",
		requiredAdapterMethods: [],
		async authenticate(ctx) {
			let key;
			if (options.header) key = ctx.headers.get(options.header);
			else {
				const value = ctx.query[options.query];
				key = Array.isArray(value) ? value[0] : value;
			}
			if (!key || typeof key !== "string") return absent();
			const user = await options.verify(key);
			return user ? authenticated(user) : invalid();
		}
	};
}
/**
* A strategy you write yourself: `resolve` inspects `ctx` and returns a user
* (or `null`). For anything the built-in strategies don't cover — a header
* convention, a third-party session, a proxy-injected identity.
*/
function custom(resolve, options = {}) {
	const strategy = {
		kind: "custom",
		requiredAdapterMethods: [],
		async authenticate(ctx) {
			const user = await resolve(ctx);
			return user ? authenticated(user) : absent();
		}
	};
	if (options.login) {
		const login = options.login;
		strategy.login = async (ctx, user) => {
			await login(ctx, user);
		};
	}
	if (options.logout) {
		const logout = options.logout;
		strategy.logout = async (ctx) => {
			await logout(ctx);
		};
	}
	return strategy;
}
/**
* Bearer auth on a signed JWT: stateless, no adapter session lookup, so it
* cannot be revoked on its own (see `require(name, { verifySession })`).
*/
function jwt(options = {}) {
	if (options.secret && options.keys) throw new Error("jwt(): pass either \"secret\" or \"keys\", not both");
	if (options.keys && !options.algorithm) throw new Error("jwt(): \"algorithm\" is required when using \"keys\"");
	const algorithm = options.algorithm ?? "HS256";
	const ttlMs = parseDuration(options.ttl ?? "15m", "jwt ttl");
	const signingKey = options.keys ? Promise.resolve(options.keys.privateKey) : Promise.resolve(new TextEncoder().encode(options.secret ?? throwNoSecret()));
	const verifyingKey = options.keys ? Promise.resolve(options.keys.publicKey) : signingKey;
	async function sign(claims, overrideTtlMs) {
		let builder = new jose.SignJWT(claims).setProtectedHeader({ alg: algorithm }).setIssuedAt().setExpirationTime(Math.floor((Date.now() + (overrideTtlMs ?? ttlMs)) / 1e3));
		if (options.issuer !== void 0) builder = builder.setIssuer(options.issuer);
		if (options.audience !== void 0) builder = builder.setAudience(options.audience);
		return builder.sign(await signingKey);
	}
	async function verify(token) {
		const { payload } = await jose.jwtVerify(token, await verifyingKey, {
			algorithms: [algorithm],
			...options.issuer === void 0 ? {} : { issuer: options.issuer },
			...options.audience === void 0 ? {} : { audience: options.audience }
		});
		return payload;
	}
	return {
		kind: "jwt",
		ttlMs,
		sign,
		verify,
		requiredAdapterMethods: ["findUserById"],
		async authenticate(ctx, { adapter }) {
			const token = ctx.bearer();
			if (!token) return absent();
			let payload;
			try {
				payload = await verify(token);
			} catch {
				return invalid();
			}
			if (typeof payload.sub !== "string") return invalid();
			const user = await adapter.findUserById(payload.sub);
			return user ? authenticated(user) : invalid();
		}
	};
}
function throwNoSecret() {
	throw new Error("jwt(): pass \"secret\" or \"keys\"");
}
/**
* Bearer auth on an opaque, server-stored token: the adapter holds only the
* token's hash, so tokens can be listed and revoked. Backs `require("token")`-
* style routes and is also what `issueTokens`/`refresh` mint as the refresh
* token when this strategy is configured.
*/
function opaque(options = {}) {
	const ttlMs = parseDuration(options.ttl ?? "30d", "opaque ttl");
	const rolling = options.rolling ?? true;
	const absoluteMs = options.absolute === void 0 ? void 0 : parseDuration(options.absolute, "opaque absolute");
	const header = (options.header ?? "authorization").toLowerCase();
	return {
		kind: "opaque",
		ttlMs,
		rolling,
		absoluteMs,
		requiredAdapterMethods: [
			"findUserById",
			"createSession",
			"findSession",
			"updateSession",
			"deleteSession",
			"deleteSessionsByFamily",
			"deleteSessionsByUser"
		],
		async authenticate(ctx, { adapter }) {
			const raw = ctx.headers.get(header);
			if (!raw) return absent();
			const token = header === "authorization" ? raw.replace(/^Bearer\s+/i, "") : raw;
			if (!token) return absent();
			const tokenHash = hashToken(token);
			const session = await adapter.findSession(tokenHash);
			if (!session) return invalid();
			if (session.expiresAt.getTime() <= Date.now()) {
				await adapter.deleteSession(tokenHash);
				return invalid();
			}
			const user = await adapter.findUserById(session.userId);
			if (!user) return invalid();
			if (rolling) await rollSession(adapter, tokenHash, session, ttlMs, absoluteMs);
			return authenticated(user);
		}
	};
}
/**
* Session auth backed by a signed-free, opaque cookie: the cookie holds a
* random token, the adapter stores only its hash. `login`/`logout` on the
* returned `auth` object operate against whichever configured strategy is a
* `cookieSession()`.
*/
function cookieSession(options = {}) {
	const cookieName = options.cookie ?? "sid";
	const ttlMs = parseDuration(options.ttl ?? "30d", "session ttl");
	const rolling = options.rolling ?? true;
	const absoluteMs = options.absolute === void 0 ? void 0 : parseDuration(options.absolute, "session absolute");
	const cookieOptions = {
		...options.secure === void 0 ? {} : { secure: options.secure },
		sameSite: options.sameSite ?? "lax",
		...options.domain === void 0 ? {} : { domain: options.domain }
	};
	return {
		kind: "session",
		requiredAdapterMethods: [
			"findUserById",
			"createSession",
			"findSession",
			"updateSession",
			"deleteSession",
			"deleteSessionsByFamily",
			"deleteSessionsByUser"
		],
		async authenticate(ctx, { adapter }) {
			const token = ctx.cookies.get(cookieName);
			if (!token) return absent();
			const tokenHash = hashToken(token);
			const session = await adapter.findSession(tokenHash);
			if (!session) return invalid();
			if (session.expiresAt.getTime() <= Date.now()) {
				await adapter.deleteSession(tokenHash);
				return invalid();
			}
			const user = await adapter.findUserById(session.userId);
			if (!user) return invalid();
			if (rolling) await rollSession(adapter, tokenHash, session, ttlMs, absoluteMs);
			return authenticated(user);
		},
		async login(ctx, user, { adapter }) {
			const token = randomToken();
			const tokenHash = hashToken(token);
			const expiresAt = initialExpiry(ttlMs, absoluteMs);
			await adapter.createSession({
				tokenHash,
				userId: user.id,
				familyId: randomToken(),
				expiresAt
			});
			ctx.cookies.set(cookieName, token, {
				...cookieOptions,
				maxAge: expiresAt.getTime() - Date.now()
			});
		},
		async logout(ctx, { adapter }) {
			const token = ctx.cookies.get(cookieName);
			if (token) await adapter.deleteSession(hashToken(token)).catch(() => {});
			const { secure: _secure, sameSite: _sameSite, ...deleteOptions } = cookieOptions;
			ctx.cookies.delete(cookieName, deleteOptions);
		},
		async logoutEverywhere(userId, { adapter }) {
			await adapter.deleteSessionsByUser(userId);
		}
	};
}
//#endregion
export { AUTH_REQUIREMENT, ROLL_THROTTLE_MS, absent, apiKey, argon2, authenticated, checkAdapter, cookieSession, createAuth, csrf, currentUser, custom, getAuthRequirement, hashToken, initialExpiry, invalid, jwt, opaque, randomToken, requireUser, rollSession, scrypt };
