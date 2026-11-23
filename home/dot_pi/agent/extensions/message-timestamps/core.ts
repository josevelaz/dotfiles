const TIMESTAMP_PADDING = " ";
const TIMESTAMP_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
	dateStyle: "medium",
	timeStyle: "medium",
};
const timestampFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterKey(locales?: Intl.LocalesArgument): string {
	return locales === undefined ? "default" : locales.toString();
}

function getTimestampFormatter(locales?: Intl.LocalesArgument): Intl.DateTimeFormat {
	const key = formatterKey(locales);
	let formatter = timestampFormatters.get(key);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat(locales, TIMESTAMP_FORMAT_OPTIONS);
		timestampFormatters.set(key, formatter);
	}
	return formatter;
}

export function formatMessageTimestamp(timestamp: number, locales?: Intl.LocalesArgument): string {
	return getTimestampFormatter(locales).format(new Date(timestamp));
}

export class TimestampLabelCache {
	private labels = new WeakMap<object, { timestamp: number; label: string }>();

	constructor(private readonly format: (timestamp: number) => string = formatMessageTimestamp) {}

	get(message: object, timestamp: number): string {
		const cached = this.labels.get(message);
		if (cached?.timestamp === timestamp) return cached.label;

		const label = this.format(timestamp);
		this.labels.set(message, { timestamp, label });
		return label;
	}

	clear(): void {
		this.labels = new WeakMap();
	}
}

export function addTimestampLabel(
	lines: string[],
	label: string,
	width: number,
	style: (text: string) => string,
	truncate: (text: string, width: number) => string,
): string[] {
	return [...lines, truncate(style(`${TIMESTAMP_PADDING}${label}`), width)];
}

export function addTimestampLine(
	lines: string[],
	timestamp: number | undefined,
	width: number,
	style: (text: string) => string,
	truncate: (text: string, width: number) => string,
): string[] {
	if (lines.length === 0 || timestamp === undefined || !Number.isFinite(timestamp)) {
		return lines;
	}

	return addTimestampLabel(lines, formatMessageTimestamp(timestamp), width, style, truncate);
}
