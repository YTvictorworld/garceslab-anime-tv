#!/usr/bin/env node
/**
 * Builds Seanime Tenji for LG webOS TVs: `npm run build:webos`
 *
 *   dist/webos/app/                         the packaged web app (appinfo.json + files)
 *   dist/webos/service/                     the app's JS service, the WebSocket relay (webos/service/)
 *   dist/webos/app.seanime.tenji_<v>_all.ipk  installable package (ares-install, Homebrew Channel, Dev Manager)
 *
 * Steps: check the appinfo.json images, build the web app (web-app.mjs:
 * export with Expo, relative URLs for file://, lowered JS and CSS, polyfills,
 * JASSUB), bundle the JS service for Node 8, then write the IPK.
 *
 * Flags: --skip-export  reuse dist/webos/www from a previous run
 *
 * Side-by-side test builds: WEBOS_APP_ID (and optionally WEBOS_APP_TITLE)
 * package the app under another id, so it installs next to the daily app
 * instead of replacing it, e.g.
 *
 *   WEBOS_APP_ID=app.garceslab.anime.test WEBOS_APP_TITLE="GA Test" npm run build:webos
 *
 * (the fixed "GA Test" identity; .github/workflows/ga-test.yml builds it for PRs labelled
 * needs-tv-test, docs/testing-on-tv.md)
 *
 * The relay service is renamed with it (`<id>.service`) and the app is told
 * its id at export time (EXPO_PUBLIC_WEBOS_APP_ID), so don't combine a custom
 * id with --skip-export of a default build. Without them the build is unchanged.
 *
 * Build identity (webos/build-identity.mjs): GARCESLAB_BUILD_CHANNEL = stable | nightly |
 * dev (default dev) and GARCESLAB_BUILD_COMMIT (full SHA; from git for dev builds) are
 * embedded in the app (Settings shows "v1.0.0 · nightly (abc1234)") and written to
 * dist/webos/app/build.json. CI sets them: release.yml stable, nightly.yml nightly.
 * With --skip-export the embedded identity is the one of the earlier export.
 */
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { buildIdentityEnv, gitHeadCommit, resolveBuildIdentity } from "./build-identity.mjs"
import { buildService, SERVICE_NODE } from "./service-build.mjs"
import { buildWebApp, pngSize, root, walk } from "./web-app.mjs"

const webosDir = path.join(root, "webos")
const outDir = path.join(root, "dist", "webos")
const exportDir = path.join(outDir, "www")
const appDir = path.join(outDir, "app")
const serviceDir = path.join(outDir, "service")

const args = new Set(process.argv.slice(2))

function log(message) {
    console.log(`\x1b[36m[webos]\x1b[0m ${message}`)
}

///////////////////////////////////////////////////////////////////////////////
// appinfo.json images
///////////////////////////////////////////////////////////////////////////////

/** Image fields of appinfo.json and the size LG's appinfo.json reference asks for. */
const APPINFO_IMAGES = {
    icon: [80, 80],
    largeIcon: [130, 130],
    splashBackground: [1920, 1080],
}

function checkPng(file, field, [width, height]) {
    if (!fs.existsSync(file)) {
        throw new Error(`appinfo.json ${field}: ${path.relative(root, file)} is missing`)
    }
    const size = pngSize(file)
    if (!size) {
        throw new Error(`appinfo.json ${field}: ${path.relative(root, file)} is not a PNG`)
    }
    if (size[0] !== width || size[1] !== height) {
        throw new Error(`appinfo.json ${field}: ${path.relative(root, file)} is ${size[0]}x${size[1]}, webOS expects ${width}x${height}`)
    }
}

///////////////////////////////////////////////////////////////////////////////
// IPK
///////////////////////////////////////////////////////////////////////////////

function octal(value, length) {
    return value.toString(8).padStart(length - 1, "0") + "\0"
}

function tarHeader(name, size, type, mode) {
    const header = Buffer.alloc(512)
    let prefix = ""
    let shortName = name
    if (Buffer.byteLength(name) > 100) {
        // ustar stores long paths as prefix (<= 155 bytes) + "/" + name (<= 100 bytes).
        const cut = [...name.slice(0, -1).matchAll(/\//g)]
            .map(match => match.index)
            .find(index => Buffer.byteLength(name.slice(index + 1)) <= 100)
        if (cut === undefined || Buffer.byteLength(name.slice(0, cut)) > 155) {
            throw new Error(`Path too long for the IPK: ${name}`)
        }
        prefix = name.slice(0, cut)
        shortName = name.slice(cut + 1)
    }

    header.write(shortName, 0, 100)
    header.write(octal(mode, 8), 100)
    header.write(octal(0, 8), 108)
    header.write(octal(0, 8), 116)
    header.write(octal(size, 12), 124)
    header.write(octal(Math.floor(Date.now() / 1000), 12), 136)
    header.write("        ", 148)
    header.write(type, 156)
    header.write("ustar\0", 257)
    header.write("00", 263)
    header.write("root", 265)
    header.write("root", 297)
    header.write(prefix, 345, 155)

    let checksum = 0
    for (const byte of header) checksum += byte
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148)
    return header
}

/** entries: [{ name: "usr/", dir: true, mode? } | { name: "usr/x", data: Buffer }] */
function targz(entries) {
    const chunks = []
    for (const entry of entries) {
        if (entry.dir) {
            chunks.push(tarHeader(entry.name, 0, "5", entry.mode ?? 0o755))
            continue
        }
        chunks.push(tarHeader(entry.name, entry.data.length, "0", 0o644), entry.data)
        const padding = (512 - (entry.data.length % 512)) % 512
        if (padding) chunks.push(Buffer.alloc(padding))
    }
    chunks.push(Buffer.alloc(1024))
    return zlib.gzipSync(Buffer.concat(chunks), { level: 9 })
}

function ar(members) {
    const chunks = [Buffer.from("!<arch>\n")]
    const mtime = String(Math.floor(Date.now() / 1000))
    for (const { name, data } of members) {
        const header = name.padEnd(16) + mtime.padEnd(12) + "0".padEnd(6) + "0".padEnd(6) + "100644".padEnd(8) + String(data.length).padEnd(10) + "`\n"
        chunks.push(Buffer.from(header), data)
        if (data.length % 2) chunks.push(Buffer.from("\n"))
    }
    return Buffer.concat(chunks)
}

function directoryEntries(filePath) {
    const parts = filePath.split("/").slice(0, -1)
    return parts.map((_, index) => `${parts.slice(0, index + 1).join("/")}/`)
}

function writeIpk(appinfo, serviceId) {
    const id = appinfo.id
    const installRoot = `usr/palm/applications/${id}`
    const serviceRoot = `usr/palm/services/${serviceId}`

    // Same layout as LG's ares-package output.
    const packageinfo = { id, version: appinfo.version, app: id, services: [serviceId] }

    const entries = []
    const dirs = new Set()
    const addFile = (name, data) => {
        for (const dir of directoryEntries(name)) {
            if (!dirs.has(dir)) {
                dirs.add(dir)
                // ares-package makes the service's own directory writable (0777); the rest is 0755.
                entries.push({ name: dir, dir: true, mode: dir === `${serviceRoot}/` ? 0o777 : 0o755 })
            }
        }
        entries.push({ name, data })
    }
    let installedSize = 0
    const addTree = (sourceDir, installDir) => {
        for (const file of walk(sourceDir).sort()) {
            const data = fs.readFileSync(file)
            installedSize += data.length
            addFile(`${installDir}/${path.relative(sourceDir, file).split(path.sep).join("/")}`, data)
        }
    }
    addTree(appDir, installRoot)
    addTree(serviceDir, serviceRoot)
    addFile(`usr/palm/packages/${id}/packageinfo.json`, Buffer.from(JSON.stringify(packageinfo, null, 2) + "\n"))

    const control = [
        `Package: ${id}`,
        `Version: ${appinfo.version}`,
        "Section: misc",
        "Priority: optional",
        "Architecture: all",
        `Installed-Size: ${installedSize}`,
        `Maintainer: ${appinfo.vendor} <noreply@seanime.app>`,
        `Description: ${appinfo.title}`,
        "webOS-Package-Format-Version: 2",
        "webOS-Packager-Version: x.y.x",
        "",
    ].join("\n")

    const ipk = ar([
        { name: "debian-binary", data: Buffer.from("2.0\n") },
        { name: "control.tar.gz", data: targz([{ name: "control", data: Buffer.from(control) }]) },
        { name: "data.tar.gz", data: targz(entries) },
    ])

    const ipkPath = path.join(outDir, `${id}_${appinfo.version}_all.ipk`)
    fs.writeFileSync(ipkPath, ipk)
    return ipkPath
}

///////////////////////////////////////////////////////////////////////////////

async function main() {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const appinfo = JSON.parse(fs.readFileSync(path.join(webosDir, "appinfo.json"), "utf8"))
    appinfo.version = pkg.version
    const customId = process.env.WEBOS_APP_ID?.trim()
    if (customId) {
        // webOS ids: lowercase letters, digits, dots and dashes, starting with a letter.
        if (!/^[a-z][a-z0-9.-]*$/.test(customId)) {
            throw new Error(`WEBOS_APP_ID "${customId}" is not a valid webOS app id (lowercase letters, digits, "." and "-")`)
        }
        appinfo.id = customId
        appinfo.title = process.env.WEBOS_APP_TITLE?.trim() || `${appinfo.title} (${customId})`
        // Read by luna-websocket.ts, inlined by the Expo export.
        process.env.EXPO_PUBLIC_WEBOS_APP_ID = customId
        log(`Side-by-side build: ${appinfo.id} "${appinfo.title}"`)
    } else {
        delete process.env.EXPO_PUBLIC_WEBOS_APP_ID
    }
    // Embedded by the export and written next to appinfo.json for external tools. webOS
    // only takes a numeric appinfo.json version, so the channel and commit live here.
    const identity = resolveBuildIdentity({ version: pkg.version, env: process.env, gitCommit: () => gitHeadCommit(root) })
    Object.assign(process.env, buildIdentityEnv(identity))
    log(`Build: v${identity.version} · ${identity.channel}${identity.shortCommit ? ` (${identity.shortCommit})` : ""}`)
    // Checked first so a bad image fails the build before the slow export.
    const images = Object.entries(APPINFO_IMAGES).filter(([field]) => appinfo[field])
    for (const [field, size] of images) checkPng(path.join(webosDir, appinfo[field]), field, size)

    await buildWebApp({ exportDir, appDir, skipExport: args.has("--skip-export"), log })

    fs.writeFileSync(path.join(appDir, "appinfo.json"), JSON.stringify(appinfo, null, 4) + "\n")
    fs.writeFileSync(path.join(appDir, "build.json"), JSON.stringify(identity, null, 2) + "\n")
    for (const [field] of images) {
        fs.copyFileSync(path.join(webosDir, appinfo[field]), path.join(appDir, appinfo[field]))
    }

    log(`Bundling the WebSocket relay service for Node ${SERVICE_NODE}…`)
    const serviceId = await buildService({ appId: appinfo.id, version: appinfo.version, outDir: serviceDir })

    const ipkPath = writeIpk(appinfo, serviceId)
    log(`App directory: ${path.relative(root, appDir)}`)
    log(`Service:       ${path.relative(root, serviceDir)} (${serviceId})`)
    log(`Package:       ${path.relative(root, ipkPath)}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
