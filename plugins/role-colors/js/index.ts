import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { getNativeModule } from '@valenced/modules/native'
import { after, before, instead } from '@valenced/patcher'
import { ReactJSXRuntime } from '@valenced/react'
import { insteadJSX } from '@valenced/react/jsx-runtime'

// Colors names in the typing indicator and mentions in messages with each person's role color.

type Props = Record<string, unknown>
type Element = { type?: unknown; props: Props }

interface TypingProps {
	typingUserIds?: unknown[]
	channel?: { guild_id?: unknown }
}

interface MemberStore {
	getMember?: (guildId: unknown, userId: unknown) => { nick?: unknown; colorString?: unknown } | null | undefined
}

interface UserStore {
	getUser?: (userId: unknown) => { globalName?: unknown; global_name?: unknown; username?: unknown } | null | undefined
}

interface ChannelStore {
	getChannel?: (channelId: unknown) => { guild_id?: unknown } | null | undefined
}

interface MessageData {
	channelId?: unknown
	shouldShowRoleOnName?: boolean
	content?: unknown
	referencedMessage?: { message?: MessageData }
}

const names = new WeakMap<object, string>()
let Inner: unknown
let unpatchInner: (() => boolean) | undefined

function typeName(type: unknown): string {
	if (typeof type === 'string') return type
	if (!type || (typeof type !== 'function' && typeof type !== 'object')) return ''

	const cached = names.get(type as object)
	if (cached !== undefined) return cached

	const named = type as { displayName?: string; name?: string; type?: unknown; render?: unknown }
	let name = named.displayName || named.name || ''
	if (!name && named.type) name = typeName(named.type)
	if (!name && typeof named.render === 'function') name = (named.render as { name?: string }).name || ''

	names.set(type as object, name)
	return name
}

function isElement(node: unknown): node is Element {
	return !!node && typeof node === 'object' && 'props' in node && !!(node as Element).props
}

// First string found inside an element, which is the displayed name.
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

function roleColor(guildId: unknown, userId: unknown) {
	const member = (Stores.GuildMemberStore as unknown as MemberStore | undefined)?.getMember?.(guildId, userId)
	const color = member?.colorString
	return typeof color === 'string' && color ? color : undefined
}

// Display names a person can appear under in the indicator.
function namesOf(guildId: unknown, userId: unknown) {
	const member = (Stores.GuildMemberStore as unknown as MemberStore | undefined)?.getMember?.(guildId, userId)
	const user = (Stores.UserStore as unknown as UserStore | undefined)?.getUser?.(userId)
	return [member?.nick, user?.globalName, user?.global_name, user?.username].filter(
		(name): name is string => typeof name === 'string' && name.length > 0,
	)
}

function paint(element: Element, color: string): Element {
	return { ...element, props: { ...element.props, style: [element.props.style, { color }] } }
}

function sameItems(a: unknown[], b: unknown[]) {
	return a.length === b.length && a.every((item, i) => item === b[i])
}

// Rebuilds the tree, painting name elements inside the Text that holds them.
function transform(node: unknown, guildId: unknown, ids: unknown[]): unknown {
	if (Array.isArray(node)) {
		const next = node.map(child => transform(child, guildId, ids))
		return sameItems(node, next) ? node : next
	}

	if (!isElement(node)) return node

	const children = node.props.children
	if (typeName(node.type) === 'Text' && children !== undefined) {
		const list = Array.isArray(children) ? children : [children]
		const elements = list.filter(isElement)

		if (elements.length > 0 && elements.length <= ids.length) {
			const painted = list.map(child => {
				if (!isElement(child)) return child

				const text = textOf(child)
				let id = ids.find(userId => text !== undefined && namesOf(guildId, userId).includes(text))
				if (id === undefined && elements.length === ids.length) id = ids[elements.indexOf(child)]

				const color = id === undefined ? undefined : roleColor(guildId, id)
				return color ? paint(child, color) : child
			})

			return { ...node, props: { ...node.props, children: painted } }
		}
	}

	if (children === undefined) return node
	const next = transform(children, guildId, ids)
	return next === children ? node : { ...node, props: { ...node.props, children: next } }
}

function renderInner(props: unknown) {
	const component = Inner as {
		type?: (props: unknown) => unknown
		render?: (props: unknown, ref: unknown) => unknown
	}
	if (typeof Inner === 'function') return (Inner as (props: unknown) => unknown)(props)
	if (typeof component?.type === 'function') return component.type(props)
	if (typeof component?.render === 'function') return component.render(props, null)
	return null
}

function TypingIndicatorColored(props: unknown) {
	const tree = renderInner(props)

	try {
		const { typingUserIds, channel } = props as TypingProps
		const guildId = channel?.guild_id
		if (!guildId || !typingUserIds?.length) return tree

		return transform(tree, guildId, typingUserIds)
	} catch {
		return tree
	}
}

// Finds the typing indicator component the first time it is drawn.
function watch(type: unknown) {
	if (Inner || typeName(type) !== 'TypingIndicatorInner') return

	Inner = type
	unpatchInner = insteadJSX(type as never, (args, jsx) => jsx(TypingIndicatorColored as never, args[1] as never, args[2]))
}

// Walks a message's content, coloring every user mention in place.
function colorMentionsIn(node: unknown, guildId: unknown, depth = 0) {
	if (!node || typeof node !== 'object' || depth > 12) return

	if (Array.isArray(node)) {
		for (const child of node) colorMentionsIn(child, guildId, depth + 1)
		return
	}

	const component = node as Record<string, unknown>
	if (component.type === 'mention' && typeof component.userId === 'string') {
		const color = roleColor(guildId, component.userId)
		if (color && /^#[0-9a-f]{6}$/i.test(color)) {
			const value = parseInt(color.slice(1), 16)
			component.roleColor = value
			component.color = value
			component.colorString = color
		}
	}

	colorMentionsIn(component.content, guildId, depth + 1)
	colorMentionsIn(component.items, guildId, depth + 1)
}

function colorRow(row: unknown) {
	const message = (row as { message?: MessageData } | null)?.message
	if (!message) return

	const channel = (Stores.ChannelStore as unknown as ChannelStore | undefined)?.getChannel?.(message.channelId)
	const guildId = channel?.guild_id
	if (!guildId) return

	message.shouldShowRoleOnName = true
	colorMentionsIn(message.content, guildId)

	const referenced = message.referencedMessage?.message
	if (referenced) {
		referenced.shouldShowRoleOnName = true
		colorMentionsIn(referenced.content, guildId)
	}
}

// Discord's chat list is drawn natively. Its rows are built or sent as data before they reach the screen.
// Editing that data is the only place mentions can be colored. Two routes exist, so both are tried.
function patchMentions(cleanup: (callback: () => unknown) => unknown) {
	// Route 1: rows sent to the native chat module as JSON. Missing on some builds.
	try {
		const manager = getNativeModule<Record<string, unknown>>('DCDChatManager')

		if (manager && typeof manager.updateRows === 'function') {
			cleanup(
				before(manager as never, 'updateRows' as never, ((args: unknown[]) => {
					try {
						const rows = JSON.parse(args[1] as string)
						if (!Array.isArray(rows)) return args

						for (const row of rows) colorRow(row)
						return [args[0], JSON.stringify(rows), ...args.slice(2)]
					} catch {
						// Leave the rows as they are, so messages still load.
						return args
					}
				}) as never),
			)
		}
	} catch {
		// Module not found on this build.
	}

	// Route 2: the row builder, which returns each row as data.
	cleanup(
		getModules(withName<any>('RowManager'), (exports: any) => {
			const RowManager = exports?.prototype?.generate ? exports : exports?.default
			if (typeof RowManager?.prototype?.generate !== 'function') return

			cleanup(
				after(RowManager.prototype as never, 'generate' as never, ((row: unknown) => {
					try {
						colorRow(row)
					} catch {
						// Skip this row.
					}

					return row
				}) as never),
			)
		}),
	)
}

export default plugin({
	start({ cleanup }) {
		patchMentions(cleanup)

		cleanup(
			instead(ReactJSXRuntime, 'jsx', (args, original) => {
				watch(args[0])
				return original(...args)
			}),
		)
		cleanup(
			instead(ReactJSXRuntime, 'jsxs', (args, original) => {
				watch(args[0])
				return original(...args)
			}),
		)
		cleanup(() => unpatchInner?.())
	},
})
