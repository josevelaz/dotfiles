export class Mutex {
	private locked = false
	private queue: (() => void)[] = []

	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true
			return
		}

		return new Promise<void>((resolve) => {
			this.queue.push(resolve)
		})
	}

	release(): void {
		const next = this.queue.shift()
		if (next) {
			next()
			return
		}

		this.locked = false
	}

	async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire()
		try {
			return await fn()
		} finally {
			this.release()
		}
	}
}
