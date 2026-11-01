import test from "node:test";
import assert from "node:assert/strict";
import { parseTime, formatTime } from "../../custom_components/cronotermostato/frontend/lib/time.js";

test("round trip of every minute of the day", () => {
  for (let m = 0; m <= 1440; m++) {
    assert.equal(parseTime(formatTime(m), { asEnd: true }), m);
  }
});

test("formatTime pads and accepts 1440", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(485), "08:05");
  assert.equal(formatTime(1440), "24:00");
});

test("formatTime rejects out of range and non integers", () => {
  for (const bad of [-1, 1441, 1.5, NaN, "480", null, undefined, true]) {
    assert.throws(() => formatTime(bad), RangeError, String(bad));
  }
});

test("24:00 is accepted only as an end", () => {
  assert.equal(parseTime("24:00", { asEnd: true }), 1440);
  assert.equal(parseTime("24:00"), null);
  assert.equal(parseTime("24:00", { asEnd: false }), null);
  assert.equal(parseTime("24:01", { asEnd: true }), null);
});

test("00:00 parses as a start and as a time", () => {
  assert.equal(parseTime("00:00"), 0);
});

test("H:MM is accepted for typing, H:M and out of range are not", () => {
  assert.equal(parseTime("7:05"), 425);
  assert.equal(parseTime("7:5"), null);
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseTime("12:60"), null);
  assert.equal(parseTime("-1:00"), null);
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("ab:cd"), null);
  assert.equal(parseTime("08:00\n"), null);
  assert.equal(parseTime(" 08:00"), null);
});

test("non strings give null", () => {
  for (const bad of [null, undefined, 480, {}, [], true]) {
    assert.equal(parseTime(bad), null);
  }
});
