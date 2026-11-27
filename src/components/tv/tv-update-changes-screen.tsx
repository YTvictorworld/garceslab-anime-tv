import { tvUpdateInstallAtom, useTVUpdateActions, useTVUpdates } from "@/api/hooks/tv-updates.hooks"
import { TVButton, useTVFocus } from "@/components/tv/tv-focus"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { BRAND, TVUpdateMark } from "@/components/tv/tv-update-banner"
import { buildDescription, nonEmptyGroups, pendingSummary, type TVUpdateChange } from "@/lib/tv-updates/tv-updates"
import { router } from "expo-router"
import { useAtomValue } from "jotai"
import * as React from "react"
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

const noop = () => {}

const GROUP_COLORS: Record<string, { text: string; background: string }> = {
    New: { text: "#e6b0fd", background: "rgba(164,67,207,0.22)" },
    Fixes: { text: "#86efac", background: "rgba(134,239,172,0.14)" },
    Other: { text: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.08)" },
}

/** One change; focusable so the D-pad scrolls the list one line at a time. */
function ChangeRow({ change }: { change: TVUpdateChange }) {
    const focus = useTVFocus(1.01, change.title)
    return (
        <Pressable
            onPress={noop}
            onFocus={focus.focus}
            onBlur={focus.blur}
            accessibilityRole="text"
            accessibilityLabel={change.pr ? `${change.title}, pull request ${change.pr}` : change.title}
        >
            <Animated.View
                style={[
                    focus.style,
                    {
                        flexDirection: "row",
                        alignItems: "center",
                        paddingVertical: tvSize(12),
                        paddingHorizontal: tvSize(18),
                        borderRadius: tvSize(12),
                        backgroundColor: focus.focused ? "rgba(255,255,255,0.1)" : "transparent",
                    },
                ]}
            >
                <Text className="text-white" style={{ flex: 1, fontSize: tvSize(21), lineHeight: tvSize(29) }} numberOfLines={2}>
                    {change.title}
                </Text>
                {change.pr ? (
                    <Text className="text-white/35" style={{ fontSize: tvSize(17), marginLeft: tvSize(16) }}>
                        {`#${change.pr}`}
                    </Text>
                ) : null}
            </Animated.View>
        </Pressable>
    )
}

function Group({ title, changes }: { title: string; changes: TVUpdateChange[] }) {
    const colors = GROUP_COLORS[title] ?? GROUP_COLORS.Other
    return (
        <View style={{ marginTop: tvSize(26) }}>
            <View style={{ flexDirection: "row", paddingHorizontal: tvSize(18), marginBottom: tvSize(6) }}>
                <View style={{ paddingHorizontal: tvSize(12), paddingVertical: tvSize(4), borderRadius: tvSize(99), backgroundColor: colors.background }}>
                    <Text className="font-bold uppercase" style={{ fontSize: tvSize(15), letterSpacing: tvSize(1.5), color: colors.text }}>
                        {`${title} · ${changes.length}`}
                    </Text>
                </View>
            </View>
            {changes.map(change => <ChangeRow key={`${change.pr ?? ""}:${change.title}`} change={change} />)}
        </View>
    )
}

/**
 * Garceslab Anime: "See what's new" for the pending TV build. Only the groups that have
 * changes are shown; a build without a change list gets one short line.
 */
export function TVUpdateChangesScreen() {
    const { data: state } = useTVUpdates()
    const request = useAtomValue(tvUpdateInstallAtom)
    const actions = useTVUpdateActions()
    const status = state?.kind === "ready" ? state.status : null
    const pending = status?.pending ?? null
    const groups = React.useMemo(() => nonEmptyGroups(pending?.changes ?? []), [pending])
    const busy = request.phase === "sending" || request.phase === "installing"
    const summary = pending ? pendingSummary(pending) : null
    const commits = pending?.shortCommit
        ? status?.installed?.shortCommit ? `Build ${pending.shortCommit}, replaces ${status.installed.shortCommit}` : `Build ${pending.shortCommit}`
        : null

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: TV.gutter, paddingTop: tvSize(64), paddingBottom: tvSize(90) }}
                showsVerticalScrollIndicator={false}
            >
                <View style={{ maxWidth: tvSize(920), width: "100%", marginHorizontal: "auto" }}>
                    <View
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            padding: tvSize(22),
                            borderRadius: tvSize(20),
                            borderWidth: tvSize(1),
                            borderColor: "rgba(164,67,207,0.55)",
                            borderLeftWidth: tvSize(6),
                            borderLeftColor: BRAND,
                            backgroundColor: "#1d1224",
                        }}
                    >
                        <TVUpdateMark size={64} />
                        <View style={{ flex: 1, marginLeft: tvSize(20) }}>
                            <Text className="font-bold text-white" style={{ fontSize: tvSize(34) }}>
                                {pending ? "What's new" : "Garceslab Anime is up to date"}
                            </Text>
                            {pending ? (
                                <Text style={{ fontSize: tvSize(19), marginTop: tvSize(4), color: "#e6b0fd" }} numberOfLines={1}>
                                    {[buildDescription(pending, status?.channel), pending.changes.length ? summary : null].filter(Boolean).join(" · ")}
                                </Text>
                            ) : null}
                            {commits ? (
                                <Text className="text-white/40" style={{ fontSize: tvSize(16), marginTop: tvSize(4) }} numberOfLines={1}>
                                    {commits}
                                </Text>
                            ) : null}
                        </View>
                    </View>

                    {busy ? (
                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: tvSize(20) }}>
                            <ActivityIndicator size="small" color="#e6b0fd" />
                            <Text className="text-white/75" style={{ fontSize: tvSize(19), marginLeft: tvSize(12) }}>
                                Installing… Garceslab Anime will close and open again by itself.
                            </Text>
                        </View>
                    ) : request.phase === "failed" ? (
                        <Text style={{ fontSize: tvSize(19), marginTop: tvSize(20), color: "#fca5a5" }}>
                            {`The update wasn't installed: ${request.error}`}
                        </Text>
                    ) : null}

                    <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={{ flexDirection: "row", marginTop: tvSize(22) }}>
                        {pending ? (
                            <View style={{ marginRight: tvSize(14) }}>
                                <TVButton
                                    label={busy ? "Installing…" : "Install"}
                                    variant="primary"
                                    disabled={busy}
                                    hasTVPreferredFocus
                                    onPress={actions.askToInstall}
                                />
                            </View>
                        ) : null}
                        <TVButton label="Back" hasTVPreferredFocus={!pending} onPress={() => router.back()} />
                    </TVFocusGuideView>

                    {pending && groups.length === 0 ? (
                        <Text className="text-white/55" style={{ fontSize: tvSize(19), marginTop: tvSize(26), paddingHorizontal: tvSize(18) }}>
                            No change list for this build.
                        </Text>
                    ) : null}
                    {groups.map(group => <Group key={group.title} title={group.title} changes={group.changes} />)}
                    {groups.length > 0 && pending?.changesComplete === false ? (
                        <Text className="text-white/40" style={{ fontSize: tvSize(17), marginTop: tvSize(22), paddingHorizontal: tvSize(18) }}>
                            Some changes may be missing: the updater didn't see every build since the installed one.
                        </Text>
                    ) : null}
                </View>
            </ScrollView>
        </View>
    )
}
