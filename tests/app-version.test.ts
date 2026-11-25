import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import appConfig from "../app.config.ts"
import { APP_RELEASE_API_URL, APP_RELEASE_REPOSITORY, compareSemverLike } from "../src/lib/app-release.ts"
import { MIN_SERVER_VERSION } from "../src/lib/constants.ts"

// Garceslab Anime TV's own version (docs/releasing.md): package.json is the source, and
// every other place that carries it must agree, or the release workflow, the .ipk name
// (webos/build.mjs) and the version shown in Settings drift apart.
const readJson = (path: string): any => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"))
const pkg = readJson("../package.json")
const lock = readJson("../package-lock.json")

test("the version is plain MAJOR.MINOR.PATCH, 1.0.0 or later", () => {
    assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
    assert.ok(compareSemverLike(pkg.version, "1.0.0") >= 0, `${pkg.version} is below 1.0.0`)
})

test("package-lock.json carries the same version", () => {
    assert.equal(lock.version, pkg.version)
    assert.equal(lock.packages[""].version, pkg.version)
})

test("app.config.ts (shown in Settings) carries the same version, phone and TV", () => {
    const previous = process.env.EXPO_TV
    try {
        for (const tv of [undefined, "1"]) {
            if (tv) process.env.EXPO_TV = tv
            else delete process.env.EXPO_TV
            const config = appConfig({ config: {} } as never)
            assert.equal(config.version, pkg.version)
        }
    }
    finally {
        if (previous === undefined) delete process.env.EXPO_TV
        else process.env.EXPO_TV = previous
    }
})

test("the webOS app id stays app.seanime.tenji and build.mjs takes the version from package.json", () => {
    const appinfo = readJson("../webos/appinfo.json")
    assert.equal(appinfo.id, "app.seanime.tenji")
    const build = fs.readFileSync(new URL("../webos/build.mjs", import.meta.url), "utf8")
    assert.match(build, /appinfo\.version = pkg\.version/)
    assert.match(build, /`\$\{id\}_\$\{appinfo\.version\}_all\.ipk`/)
})

test("the in-app update check looks at this repository's releases", () => {
    assert.equal(APP_RELEASE_REPOSITORY, "YTvictorworld/garceslab-anime-tv")
    assert.equal(APP_RELEASE_API_URL, "https://api.github.com/repos/YTvictorworld/garceslab-anime-tv/releases/latest")
    assert.equal(compareSemverLike("v1.0.1", "1.0.0"), 1)
    assert.equal(compareSemverLike("v1.0.0", "1.0.0"), 0)
    // An older (e.g. Seanime Tenji 0.x) tag never offers a "newer" app.
    assert.equal(compareSemverLike("v0.5.0", "1.0.0"), -1)
})

// The server reports Seanime's version (3.10.x) in status.version and its own Garceslab
// version separately (garceslabVersion), so this check keeps working after 1.0.
test("the minimum server version is still a Seanime 3.x version", () => {
    assert.match(MIN_SERVER_VERSION, /^3\.\d+\.\d+$/)
    assert.ok(compareSemverLike("3.10.5", MIN_SERVER_VERSION) >= 0)
})
