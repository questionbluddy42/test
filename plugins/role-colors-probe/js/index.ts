import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { lookupModules } from '@valenced/modules/finders'
import { createFilterGenerator } from '@valenced/modules/finders/filters'

// Temporary probe: searches loaded Discord modules for mention and role color pieces.
// Runs a few times after start, so modules that load later are found too.

const MENTION = /mention/i
const ROLE_COLOR = /(role.*colou?r|member.*colou?r|colou?r.*role)/i
const MAX_LINES = 60
const SCAN_TIMES = [15000, 45000, 90000]

const found = new Map<number, string>()
const timers: ReturnType<typeof setTimeout>[] = []

function keysOf(exports: unknown): string[] {
	if (!exports || (typeof exports !== 'object' && typeof exports !== 'function')) return []

	const keys = new Set<string>()
	for (const key of Object.keys(exports)) keys.add(key)

	const fallback = (exports as { default?: unknown }).default
	if (fallback && (typeof fallback === 'object' || typeof fallback === 'function'))
		for (const key of Object.keys(fallback)) keys.add(`default.${key}`)

	return [...keys]
}

const withMentionKeys = createFilterGenerator<[]>(
	(_, _id, exports) => keysOf(exports).some(key => MENTION.test(key) || ROLE_COLOR.test(key)),
	() => 'role-colors-probe.scan',
)

function toast(text: string) {
	try {
		ToastActionCreators.open('role-colors-probe', { text, duration: 5000 })
	} catch {
		try {
			ToastActionCreators.open({ key: 'role-colors-probe', content: text } as never)
		} catch {}
	}
}

function scan() {
	try {
		for (const [exports, id] of lookupModules(withMentionKeys(), { cached: false })) {
			if (found.has(id) || found.size >= MAX_LINES) continue

			const keys = keysOf(exports)
			const hits = keys.filter(key => MENTION.test(key) || ROLE_COLOR.test(key))
			found.set(id, `#${id}: ${hits.slice(0, 8).join(', ')} (${keys.length} keys)`)
		}
	} catch (error) {
		found.set(-1, `scan error: ${String(error)}`)
	}

	Clipboard.setString([...found.values()].join('\n'))
	toast(`Probe copied ${found.size} lines. Paste it in the chat.`)
}

export default plugin({
	start({ cleanup }) {
		for (const delay of SCAN_TIMES) timers.push(setTimeout(scan, delay))
		cleanup(() => timers.forEach(clearTimeout))
	},
})
