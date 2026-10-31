import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { waitForModules } from '@valenced/modules/finders'
import { createFilterGenerator, withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'

// Temporary probe: records what Discord's mention functions receive and return.

type Fn = (...args: unknown[]) => unknown

const report = new Map<string, string>()
const counts = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined

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
		const element = value as { type?: unknown; props?: Record<string, unknown> }
		const type = element.type as { displayName?: string; name?: string } | string | undefined
		const name = typeof type === 'string' ? type : type?.displayName || type?.name || '?'
		const props = element.props ?? {}
		const items = Object.keys(props)
			.slice(0, 10)
			.map(key => `${key}:${key === 'children' ? shape(props[key], depth - 1) : label(props[key])}`)
		return `<${name} ${items.join(' ')}>`
	}

	const record = value as Record<string, unknown>
	const items = Object.keys(record)
		.slice(0, 14)
		.map(key => `${key}:${shape(record[key], depth - 1)}`)
	return `{${items.join(', ')}}`
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

function add(key: string, text: string) {
	report.set(key, text)

	if (timer) clearTimeout(timer)
	timer = setTimeout(() => {
		Clipboard.setString([...report.entries()].map(([k, v]) => `## ${k}\n${v}`).join('\n'))
		toast(`Probe copied ${report.size} entries. Paste it in the chat.`)
	}, 6000)
}

// Records the first few calls of one function: its arguments and what it returned.
function spy(target: Record<string, unknown>, name: string, id: number) {
	const descriptor = Object.getOwnPropertyDescriptor(target, name)
	add(
		`status ${name} #${id}`,
		`module found | descriptor: ${descriptor ? `configurable=${descriptor.configurable} writable=${descriptor.writable} getter=${typeof descriptor.get}` : 'none (inherited)'}`,
	)

	try {
		instead(target as never, name as never, ((args: unknown[], original: Fn) => {
			const result = original(...args)

			try {
				const seen = counts.get(`${name}#${id}`) ?? 0
				if (seen < 2) {
					counts.set(`${name}#${id}`, seen + 1)
					add(
						`${name} #${id} call ${seen + 1}`,
						`args: ${args.map(arg => shape(arg, 3)).join(' | ')}\nresult: ${shape(result, 3)}`,
					)
				}
			} catch {}

			return result
		}) as never)
	} catch (error) {
		add(`status ${name} #${id} patch error`, String(error))
	}
}

// Matches modules whose default export has the property.
const withDefaultProp = createFilterGenerator<[name: string]>(
	([name], _id, exports) => {
		const fallback = (exports as { default?: unknown } | null)?.default
		return !!fallback && (typeof fallback === 'object' || typeof fallback === 'function') && name in fallback
	},
	([name]) => `role-colors-probe.default(${name})`,
)

export default plugin({
	// Runs early, so the functions are patched before Discord's other code copies them.
	preInit({ cleanup }) {
		add('status', 'probe 0.6 loaded in preInit')

		const topLevel = [
			'hydrateRoleMention',
			'hydrateCommandMention',
			'inlineChannelMentionReact',
			'createFetchingGameMentionRule',
		]
		const underDefault = ['combineAndInjectMentionRule', 'channelMention', 'gameMention']

		for (const name of topLevel) {
			cleanup(
				waitForModules(withProps<Record<string, unknown>>(name), (exports, id) => {
					if (typeof exports[name] === 'function') spy(exports, name, id)
				}),
			)
		}

		for (const name of underDefault) {
			cleanup(
				waitForModules(withDefaultProp(name), (exports, id) => {
					const fallback = (exports as { default: Record<string, unknown> }).default
					if (typeof fallback[name] === 'function') spy(fallback, `default.${name}`.replace('default.', ''), id)
				}),
			)
		}

		cleanup(() => {
			if (timer) clearTimeout(timer)
		})
	},
})
