import assert from "node:assert/strict"
import test from "node:test"
import { appendPinDigit, isProfileRequiredError, profileErrorMessage, serverHasProfiles } from "../src/lib/profile/profile-errors.ts"
import {
    endProfileSession,
    getProfileSession,
    getProfileSessionEnd,
    getProfileToken,
    isProfileSessionExpired,
    setProfileSession,
    subscribeProfileSession,
} from "../src/lib/profile/profile-session.ts"

const profile = { id: 1, name: "Ana", avatarId: "gl-lorelei-01", sortOrder: 0, scoreFormat: "POINT_10", titleLanguage: "ROMAJI", createdAt: 0, updatedAt: 0, hasPin: false, avatarUrl: "/profile-avatars/gl-lorelei-01.svg" }

test("the session lives in memory and ends on request", () => {
    let changes = 0
    const unsubscribe = subscribeProfileSession(() => changes++)
    const now = Date.now()
    setProfileSession({ profileToken: "tok", expiresAt: Math.floor(now / 1000) + 3600, profile: profile as never }, now)
    assert.equal(getProfileToken(), "tok")
    assert.equal(getProfileSession()?.profile.name, "Ana")
    endProfileSession("switch")
    assert.equal(getProfileToken(), null)
    assert.equal(getProfileSessionEnd(), "switch")
    endProfileSession("switch")
    assert.equal(changes, 2)
    unsubscribe()
})

test("a session past its expiry is expired", () => {
    assert.equal(isProfileSessionExpired({ expiresAt: 100 }, 100_000), true)
    assert.equal(isProfileSessionExpired({ expiresAt: 200 }, 100_000), false)
})

test("profile error codes", () => {
    assert.equal(isProfileRequiredError("PROFILE_REQUIRED"), true)
    assert.equal(isProfileRequiredError("PROFILE_INVALID_TOKEN"), true)
    assert.equal(isProfileRequiredError("UNAUTHENTICATED"), false)
    assert.match(profileErrorMessage("PLAYBACK_BUSY") ?? "", /Another playback is in progress/)
    assert.match(profileErrorMessage("PROFILE_PIN_LOCKED", 240) ?? "", /4 minutes/)
    assert.equal(profileErrorMessage("something else"), null)
})

test("only servers advertising profiles get the picker", () => {
    assert.equal(serverHasProfiles(null), false)
    assert.equal(serverHasProfiles({}), false)
    assert.equal(serverHasProfiles({ profiles: { enabled: true } }), true)
})

test("PINs take up to six digits", () => {
    assert.equal(appendPinDigit("12", "3"), "123")
    assert.equal(appendPinDigit("123456", "7"), "123456")
    assert.equal(appendPinDigit("1", "x"), "1")
})
