/**
 * Stub implementations of Node.js modules for Cloudflare Workers
 * These are used when importing from src/ which has Node.js dependencies
 *
 * This file exports stubs for Node.js built-in modules that aren't available in Cloudflare Workers.
 * Vite alias configuration maps 'os', 'fs', 'path' imports to this file.
 */

// Stub for 'os' module - export as default for `import * as os from 'os'`
const osStub = {
	homedir: () => '/tmp',
	tmpdir: () => '/tmp',
	platform: () => 'cloudflare',
	type: () => 'Cloudflare',
	arch: () => 'wasm32',
	cpus: () => [],
	totalmem: () => 0,
	freemem: () => 0,
	uptime: () => 0,
	loadavg: () => [0, 0, 0],
	networkInterfaces: () => ({}),
	hostname: () => 'cloudflare-worker',
	userInfo: () => ({ username: 'worker', uid: 0, gid: 0, homedir: '/tmp', shell: '/bin/sh' }),
	endianness: () => 'LE' as const,
	EOL: '\n',
	devNull: '/dev/null',
	constants: {
		UV_UDP_REUSEADDR: 4,
		signals: {},
		errno: {},
		priority: {}
	}
};

// Export os as default (for `import * as os from 'os'`)
export default osStub;
export const os = osStub;

// Stub for 'fs' module
const fsStub = {
	readFileSync: () => '',
	writeFileSync: () => {},
	existsSync: () => false,
	mkdirSync: () => {},
	readdirSync: () => [],
	statSync: () => ({ isFile: () => false, isDirectory: () => false }),
	unlinkSync: () => {},
	rmSync: () => {},
	rmdirSync: () => {},
	accessSync: () => {},
	chmodSync: () => {},
	chownSync: () => {},
	utimesSync: () => {},
	realpathSync: () => '',
	readlinkSync: () => '',
	symlinkSync: () => {},
	linkSync: () => {},
	renameSync: () => {},
	copyFileSync: () => {},
	appendFileSync: () => {},
	truncateSync: () => {},
	watch: () => ({ close: () => {} }),
	watchFile: () => {},
	unwatchFile: () => {},
	createReadStream: () => ({}) as any,
	createWriteStream: () => ({}) as any,
	promises: {
		readFile: async () => '',
		writeFile: async () => {},
		access: async () => {},
		stat: async () => ({ isFile: () => false, isDirectory: () => false }),
		mkdir: async () => {},
		readdir: async () => [],
		unlink: async () => {},
		rm: async () => {},
		rmdir: async () => {},
		chmod: async () => {},
		chown: async () => {},
		utimes: async () => {},
		realpath: async () => '',
		readlink: async () => '',
		symlink: async () => {},
		link: async () => {},
		rename: async () => {},
		copyFile: async () => {},
		appendFile: async () => {},
		truncate: async () => {}
	}
};
export const fs = fsStub;

// Stub for 'path' module
const pathStub = {
	join: (...args: string[]) => args.join('/'),
	resolve: (...args: string[]) => args.join('/'),
	normalize: (p: string) => p,
	isAbsolute: () => false,
	relative: () => '',
	dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '.',
	basename: (p: string, ext?: string) => {
		const name = p.split('/').pop() || p;
		return ext ? name.replace(new RegExp(ext + '$'), '') : name;
	},
	extname: (p: string) => {
		const parts = p.split('.');
		return parts.length > 1 ? '.' + parts.pop() : '';
	},
	format: () => '',
	parse: () => ({ root: '', dir: '', base: '', ext: '', name: '' }),
	sep: '/',
	delimiter: ':',
	posix: {} as any,
	win32: {} as any
};
export const path = pathStub;
