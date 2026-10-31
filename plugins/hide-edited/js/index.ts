import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { getNativeModule } from '@valenced/modules/native'
import { after, before } from '@valenced/patcher'

// Hides the "(edited)" label. The chat list gets it from the message's `edited` field, so removing it hides the label.

interface MessageData {
	edited?: unknown
	referencedMessage?: { message?: MessageData }
}

function hideEdited(row: unknown) {
	const message = (row as { message?: MessageData } | null)?.message
	if (!message) return

	delete message.edited

	const referenced = message.referencedMessage?.message
	if (referenced) delete referenced.edited
}

export default plugin({
	start({ cleanup }) {
		// Route 1: rows sent to the native chat module as JSON. Missing on some builds.
		try {
			const manager = getNativeModule<Record<string, unknown>>('DCDChatManager')

			if (manager && typeof manager.updateRows === 'function') {
				cleanup(
					before(manager as never, 'updateRows' as never, ((args: unknown[]) => {
						try {
							const rows = JSON.parse(args[1] as string)
							if (!Array.isArray(rows)) return args

							for (const row of rows) hideEdited(row)
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
							hideEdited(row)
						} catch {
							// Skip this row.
						}

						return row
					}) as never),
				)
			}),
		)
	},
})
