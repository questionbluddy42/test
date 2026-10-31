import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { waitForModules } from '@valenced/modules/finders'
import { createFilterGenerator, withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'

// Temporary probe. Wraps mention and role color functions and counts which ones run.
// Also watches for @ text being created, with a short call trail.

type Props = Record<string, unknown>
type Fn = (...args: unknown[]) => unknown

const WANTED = /mention|hydrate|colou?r/i
const MENTION = /mention/i
const ROLE_COLOR = /(role.*colou?r|member.*colou?r|colou?r.*role)/i

const entries = new Map<string, string>()
const calls = new Map<string, number>()
const names = new WeakMap<object, string>()
let wrapped = 0
let timer: ReturnType<typeof setTimeout> | undefined

function typeName(type: unknown): string {
	if (typeof type === 'string') return type
	if (!type || (typeof type !== 'function' && typeof type !== 'object')) return ''

	const cached = names.get(type as object)
	if (cached !== undefined) return cached

	const named = type as { displayName?: string; name?: string; type?: unknown; render?: unknown }
	let name = named.displayName || named.name || ''
	if (!name && named.type) name = typeName(named.type)
	if (!name && typeof named.render === 'function') name = (named.render as { name?: string }).name || ''

	names.set(type as object, name || '?')
	return name || '?'
}

function label(value: unknown): string {
	if (typeof value === 'function') return 'fn'
	if (typeof value === 'string') return `'${value.slice(0, 24)}'`
	if (Array.isArray(value)) return `arr${value.length}`
	if (value && typeof value === 'object') return 'obj'
	return String(value)
}

// Short text for a value, going a few levels into objects.
function shape(value: unknown, depth: number): string {
	if (depth <= 0 || !value || typeof value !== 'object') return label(value)

	if (Array.isArray(value)) {
		const first = value.slice(0, 3).map(item => shape(item, depth - 1))
		return `[${first.join(', ')}${value.length > 3 ? `, ...${value.length}` : ''}]`
	}

	if ('$$typeof' in value && 'props' in value) {
		const element = value as { type?: unknown; props?: Props }
		const props = element.props ?? {}
		const items = Object.keys(props)
			.slice(0, 10)
			.map(key => `${key}:${label(props[key])}`)
		return `<${typeName(element.type)} ${items.join(' ')}>`
	}

	const record = value as Props
	const items = Object.keys(record)
		.slice(0, 14)
		.map(key => `${key}:${shape(record[key], depth - 1)}`)
	return `{${items.join(', ')}}`
}

function isElement(node: unknown): node is { type?: unknown; props: Props } {
	return !!node && typeof node === 'object' && 'props' in node && !!(node as { props?: unknown }).props
}

function textOf(node: unknown): string | undefined {
	if (typeof node === 'string') return node
	if (Array.isArray(node)) {
		for (const child of node) {
			const text = textOf(child)
			if (text !== undefined) return text
		}
		return
	}
	if (isElement(node)) return textOf(node.props.children)
}

function toast(text: string) {
	try {
		ToastActionCreators.open('role-colors-probe', { text, duration: 5000 })
	} catch {
		try {
			ToastActionCreators.open({ key: 'role-colors-probe', content: text } as never)
		} catch {}
	}
}

function flush() {
	const called = [...calls.entries()].map(([name, count]) => `${name} x${count}`).join('\n')
	const body = [...entries.entries()].map(([key, value]) => `## ${key}\n${value}`).join('\n')
	Clipboard.setString(`## wrapped\n${wrapped} functions\n## called\n${called}\n${body}`)
	toast(`Probe copied: ${calls.size} functions ran. Paste it in the chat.`)
}

function schedule() {
	if (timer) clearTimeout(timer)
	timer = setTimeout(flush, 8000)
}

function wrap(target: Record<string, unknown>, key: string, id: number) {
	const name = `${key} #${id}`

	try {
		instead(target as never, key as never, ((args: unknown[], original: Fn) => {
			const result = original(...args)

			try {
				const count = (calls.get(name) ?? 0) + 1
				calls.set(name, count)
				if (count === 1) {
					entries.set(
						`first call ${name}`,
						`args: ${args.map(arg => shape(arg, 2)).join(' | ')}\nresult: ${shape(result, 2)}`,
					)
					schedule()
				}
			} catch {}

			return result
		}) as never)
		wrapped++
	} catch {}
}

function keysOf(exports: unknown): string[] {
	if (!exports || (typeof exports !== 'object' && typeof exports !== 'function')) return []
	return Object.keys(exports)
}

const withMentionKeys = createFilterGenerator<[]>(
	(_, _id, exports) => {
		const fallback = (exports as { default?: unknown } | null)?.default
		return [...keysOf(exports), ...keysOf(fallback)].some(key => MENTION.test(key) || ROLE_COLOR.test(key))
	},
	() => 'role-colors-probe.mention-modules',
)

function wrapModule(exports: unknown, id: number) {
	const targets: Props[] = []
	if (exports && (typeof exports === 'object' || typeof exports === 'function')) targets.push(exports as Props)

	const fallback = (exports as { default?: unknown } | null)?.default
	if (fallback && (typeof fallback === 'object' || typeof fallback === 'function')) targets.push(fallback as Props)

	for (const target of targets)
		for (const key of keysOf(target))
			if (WANTED.test(key) && typeof target[key] === 'function') wrap(target, key, id)
}

// Records where text starting with @ is created, with a short call trail.
function watch(type: unknown, props: unknown, children?: unknown) {
	try {
		const p = (props && typeof props === 'object' ? props : {}) as Props
		const first = textOf(children !== undefined ? children : p.children)
		if (typeof first !== 'string' || !first.startsWith('@')) return

		const name = typeName(type)
		const key = `@text <${name}>`
		if (entries.has(key) || entries.size >= 40) return

		const trail = (new Error().stack ?? '')
			.split('\n')
			.slice(2, 14)
			.map(line => line.trim().slice(0, 70))
			.join(' < ')

		entries.set(key, `props: ${shape(p, 1)} text=${label(first)}\ntrail: ${trail}`)
		schedule()
	} catch {}
}

export default plugin({
	// Runs early, so functions are patched before Discord's other code copies them.
	preInit({ cleanup }) {
		entries.set('status', 'probe 0.7 loaded in preInit')
		schedule()

		cleanup(waitForModules(withMentionKeys(), (exports, id) => wrapModule(exports, id)))

		cleanup(
			waitForModules(withProps<Record<string, unknown>>('jsx', 'jsxs'), exports => {
				for (const key of ['jsx', 'jsxs']) {
					instead(exports as never, key as never, ((args: unknown[], original: Fn) => {
						watch(args[0], args[1])
						return original(...args)
					}) as never)
				}
			}),
		)

		cleanup(
			waitForModules(withProps<Record<string, unknown>>('createElement', 'cloneElement', 'forwardRef'), exports => {
				instead(exports as never, 'createElement' as never, ((args: unknown[], original: Fn) => {
					const [type, props, ...rest] = args
					watch(type, props, rest.length > 1 ? rest : rest[0])
					return original(...args)
				}) as never)
			}),
		)

		cleanup(() => {
			if (timer) clearTimeout(timer)
		})
	},
})
