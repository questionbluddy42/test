import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { instead } from '@valenced/patcher'
import { ReactJSXRuntime } from '@valenced/react'

// Probe version: finds typing and mention components, then copies a report to the clipboard.

const WANTED = /typing|mention/i
const MAX_ENTRIES = 60

const seen = new Map<string, string>()
const decided = new WeakMap<object, string | null>()
let timer: ReturnType<typeof setTimeout> | undefined

function nameOf(type: unknown): string | null {
	if (!type || (typeof type !== 'function' && typeof type !== 'object')) return null

	const cached = decided.get(type as object)
	if (cached !== undefined) return cached

	const named = type as { displayName?: string; name?: string; type?: unknown; render?: unknown }
	let name = named.displayName || named.name || ''
	if (!name && named.type) name = nameOf(named.type) ?? ''
	if (!name && typeof named.render === 'function') name = (named.render as { name?: string }).name || ''

	const result = WANTED.test(name) ? name : null
	decided.set(type as object, result)
	return result
}

function label(value: unknown): string {
	if (typeof value === 'function') return 'fn'
	if (typeof value === 'string') return `'${value.slice(0, 20)}'`
	if (Array.isArray(value)) return `arr${value.length}`
	if (value && typeof value === 'object') return 'obj'
	return String(value)
}

function describe(props: unknown) {
	if (!props || typeof props !== 'object') return ''
	const record = props as Record<string, unknown>
	return Object.keys(record)
		.map(name => `${name}:${label(record[name])}`)
		.join(' ')
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

function scheduleCopy() {
	if (timer) clearTimeout(timer)
	timer = setTimeout(() => {
		const report = [...seen.entries()].map(([name, props]) => `${name} | ${props}`).join('\n')
		Clipboard.setString(report)
		toast(`Probe copied ${seen.size} entries. Paste it in the chat.`)
	}, 5000)
}

function watch(type: unknown, props: unknown) {
	try {
		const name = nameOf(type)
		if (!name || seen.has(name) || seen.size >= MAX_ENTRIES) return
		seen.set(name, describe(props))
		scheduleCopy()
	} catch {}
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			instead(ReactJSXRuntime, 'jsx', (args, original) => {
				watch(args[0], args[1])
				return original(...args)
			}),
		)
		cleanup(
			instead(ReactJSXRuntime, 'jsxs', (args, original) => {
				watch(args[0], args[1])
				return original(...args)
			}),
		)
		cleanup(() => {
			if (timer) clearTimeout(timer)
		})
	},
})
