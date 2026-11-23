import assert from "node:assert/strict";
import { test } from "node:test";
import { addTimestampLine, formatMessageTimestamp, TimestampLabelCache } from "./core.ts";

const TIMESTAMP = 1_700_000_000_000;

test("adds a human-readable timestamp below an agent message", () => {
	const lines = addTimestampLine(
		["agent response"],
		TIMESTAMP,
		80,
		(text) => text,
		(text) => text,
	);

	assert.deepEqual(lines, ["agent response", ` ${formatMessageTimestamp(TIMESTAMP)}`]);
});

test("uses the width-safe truncator for the timestamp", () => {
	let receivedWidth: number | undefined;
	const lines = addTimestampLine(
		["agent response"],
		TIMESTAMP,
		12,
		(text) => `dim:${text}`,
		(text, width) => {
			receivedWidth = width;
			return text.slice(0, width);
		},
	);

	assert.equal(receivedWidth, 12);
	assert.equal(lines[1].length, 12);
});

test("caches formatted timestamps by message and timestamp", () => {
	let formatCalls = 0;
	const cache = new TimestampLabelCache((timestamp) => {
		formatCalls += 1;
		return `formatted:${timestamp}`;
	});
	const message = {};

	assert.equal(cache.get(message, TIMESTAMP), `formatted:${TIMESTAMP}`);
	assert.equal(cache.get(message, TIMESTAMP), `formatted:${TIMESTAMP}`);
	assert.equal(formatCalls, 1);

	cache.get(message, TIMESTAMP + 1);
	assert.equal(formatCalls, 2);
	cache.clear();
	cache.get(message, TIMESTAMP + 1);
	assert.equal(formatCalls, 3);
});

test("does not timestamp an empty or undated message", () => {
	const empty: string[] = [];
	const undated = ["agent response"];

	const identity = (text: string) => text;
	assert.strictEqual(addTimestampLine(empty, TIMESTAMP, 80, identity, identity), empty);
	assert.strictEqual(addTimestampLine(undated, undefined, 80, identity, identity), undated);
});
