const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

/** Pi's native marker syntax. The extension leaves this text in editor state. */
export const NATIVE_PASTE_MARKER_PATTERN =
	/\[paste #(\d+)(?: (?:\+\d+ lines|\d+ chars))?\]/;

const TRAILING_NATIVE_PASTE_MARKER_PATTERN =
	/\[paste #\d+(?: (?:\+\d+ lines|\d+ chars))?\]$/;

const RENDERED_NATIVE_PASTE_MARKER_PATTERN =
	/\[paste #\d+ (?:\+(\d+) lines|(\d+) chars)\]/g;

export type RepeatedPasteProbe = {
	expandedText: string;
	pastedText: string;
};

export function startsBracketedPaste(data: string): boolean {
	return data.includes(BRACKETED_PASTE_START);
}

export function endsBracketedPaste(data: string): boolean {
	return data.includes(BRACKETED_PASTE_END);
}

/** Capture the content represented by one trailing native paste marker. */
export function createRepeatedPasteProbe(
	compactText: string,
	expandedText: string,
	cursorAtDraftEnd: boolean,
): RepeatedPasteProbe | undefined {
	if (!cursorAtDraftEnd || compactText === expandedText) return undefined;

	const marker = compactText.match(TRAILING_NATIVE_PASTE_MARKER_PATTERN);
	if (!marker || marker.index === undefined) return undefined;
	if (NATIVE_PASTE_MARKER_PATTERN.test(expandedText)) return undefined;

	const prefix = compactText.slice(0, marker.index);
	if (!expandedText.startsWith(prefix)) return undefined;

	const pastedText = expandedText.slice(prefix.length);
	if (pastedText.length === 0) return undefined;
	return { expandedText, pastedText };
}

/** True when Pi appended the same clipboard content represented by the marker. */
export function shouldExpandRepeatedPaste(
	probe: RepeatedPasteProbe,
	afterPasteExpandedText: string,
): boolean {
	return afterPasteExpandedText === probe.expandedText + probe.pastedText;
}

/** Change only complete, unsplit native marker labels in rendered editor lines. */
export function formatRenderedPasteMarkers(line: string): string {
	return line.replace(
		RENDERED_NATIVE_PASTE_MARKER_PATTERN,
		(_marker, lineCount: string | undefined, charCount: string | undefined) =>
			lineCount === undefined ? `[Pasted ${charCount} chars]` : `[Pasted ${lineCount} lines]`,
	);
}
