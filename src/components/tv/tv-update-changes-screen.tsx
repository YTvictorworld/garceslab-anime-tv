import { tvUpdateInstallAtom, useTVUpdateActions, useTVUpdates } from "@/api/hooks/tv-updates.hooks"
import { TVButton, useTVFocus } from "@/components/tv/tv-focus"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { buildLabel, changeCountsLabel, groupChanges, type TVUpdateChange } from "@/lib/tv-updates/tv-updates"
import { router } from "expo-router"
import { useAtomValue } from "jotai"
import * as React from "react"
import { Animated, Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

const noop = () => {}

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
                        paddingVertical: tvSize(14),
                        paddingHorizontal: tvSize(20),
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
    if (changes.length === 0) return null
    return (
        <View style={{ marginTop: tvSize(30) }}>
            <Text className="font-semibold uppercase text-white/40" style={{ fontSize: tvSize(15), letterSpacing: tvSize(2), paddingHorizontal: tvSize(20), marginBottom: tvSize(6) }}>
                {`${title} · ${changes.length}`}
            </Text>
            {changes.map(change => <ChangeRow key={`${change.pr ?? ""}:${change.title}`} change={change} />)}
        </View>
    )
}

/** Garceslab Anime: "See changes" for the pending TV build, grouped New / Fixes / Other. */
export function TVUpdateChangesScreen() {
    const { data: state } = useTVUpdates()
    const request = useAtomValue(tvUpdateInstallAtom)
    const actions = useTVUpdateActions()
    const status = state?.kind === "ready" ? state.status : null
    const pending = status?.pending ?? null
    const grouped = React.useMemo(() => groupChanges(pending?.changes ?? []), [pending])
    const busy = request.phase === "sending" || request.phase === "installing"

    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: TV.gutter, paddingTop: tvSize(70), paddingBottom: tvSize(90) }}
                showsVerticalScrollIndicator={false}
            >
                <View style={{ maxWidth: tvSize(900), width: "100%", marginHorizontal: "auto" }}>
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(40) }}>
                        {pending ? "What's new" : "No update waiting"}
                    </Text>
                    <Text className="text-white/55" style={{ fontSize: tvSize(20), marginTop: tvSize(8) }} numberOfLines={2}>
                        {pending
                            ? `${buildLabel(pending, status?.channel)} · ${changeCountsLabel(pending.changes)} · installed: ${buildLabel(status?.installed ?? null, status?.channel)}`
                            : "This TV already has the newest build."}
                    </Text>
                    <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={{ flexDirection: "row", marginTop: tvSize(26) }}>
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

                    {pending && pending.changes.length === 0 ? (
                        <Text className="text-white/55" style={{ fontSize: tvSize(20), marginTop: tvSize(34) }}>
                            The updater didn't list the changes of this build.
                        </Text>
                    ) : null}
                    <Group title="New" changes={grouped.features} />
                    <Group title="Fixes" changes={grouped.fixes} />
                    <Group title="Other" changes={grouped.other} />
                    {pending?.changesComplete === false ? (
                        <Text className="text-white/40" style={{ fontSize: tvSize(17), marginTop: tvSize(26), paddingHorizontal: tvSize(20) }}>
                            Some changes may be missing: the updater didn't see every build since the installed one.
                        </Text>
                    ) : null}
                </View>
            </ScrollView>
        </View>
    )
}
