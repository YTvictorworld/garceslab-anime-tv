import assert from "node:assert/strict"
import test from "node:test"
import { applyKeyboardKey, keyboardRows, searchQueryFor, typedCharacter } from "../src/lib/tv-keyboard.ts"

test("the keyboard has A-Z and 0-9 in rows of six, then Space, Delete and Clear", () => {
    const rows = keyboardRows()
    assert.equal(rows.length, 7)
    assert.ok(rows.slice(0, 6).every(row => row.length === 6))
    assert.deepEqual(rows[6].map(key => key.kind), ["space", "backspace", "clear"])
})

test("keys edit the text", () => {
    assert.equal(applyKeyboardKey("bl", { kind: "char", value: "e" }), "ble")
    assert.equal(applyKeyboardKey("ble", { kind: "backspace" }), "bl")
    assert.equal(applyKeyboardKey("ble", { kind: "clear" }), "")
    assert.equal(applyKeyboardKey("", { kind: "space" }), "")
    assert.equal(applyKeyboardKey("one ", { kind: "space" }), "one ")
    assert.equal(applyKeyboardKey("one", { kind: "space" }), "one ")
    assert.equal(applyKeyboardKey("abc", { kind: "char", value: "d" }, { maxLength: 3 }), "abc")
})

test("names get a capital at the start of each word", () => {
    let name = ""
    for (const value of "ana") name = applyKeyboardKey(name, { kind: "char", value }, { capitalize: "words" })
    name = applyKeyboardKey(name, { kind: "space" }, { capitalize: "words" })
    name = applyKeyboardKey(name, { kind: "char", value: "b" }, { capitalize: "words" })
    assert.equal(name, "Ana B")
})

test("physical keys type letters, digits and space only", () => {
    assert.equal(typedCharacter("B"), "b")
    assert.equal(typedCharacter("7"), "7")
    assert.equal(typedCharacter(" "), " ")
    assert.equal(typedCharacter("Enter"), null)
    assert.equal(typedCharacter("Backspace"), null)
    assert.equal(typedCharacter("é"), null)
})

test("search starts at two characters", () => {
    assert.equal(searchQueryFor("b"), null)
    assert.equal(searchQueryFor(" bl "), "bl")
    assert.equal(searchQueryFor(""), null)
})
