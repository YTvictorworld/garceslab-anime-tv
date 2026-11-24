// Garceslab Anime phase 3: the current profile's anime favourites (server
// endpoints /api/v1/profiles/me/favourites). Only used when the server has profiles.

import { buildSeaQuery, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { ProfileFavourite } from "@/api/generated/types"
import { useServerAuthToken, useServerUrl } from "@/atoms/server.atoms"
import { toast } from "@/lib/utils/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"

const PL = API_ENDPOINTS.PROFILES_LIBRARY

export function useMyAnimeFavourites(enabled: boolean) {
    return useServerQuery<Array<ProfileFavourite>>({
        endpoint: PL.GetMyFavourites.endpoint,
        method: "GET",
        params: { kind: "ANIME" },
        queryKey: [PL.GetMyFavourites.key, "ANIME"],
        enabled,
        muteError: true,
    })
}

export function useToggleAnimeFavourite() {
    const serverUrl = useServerUrl()
    const authToken = useServerAuthToken()
    const qc = useQueryClient()
    return useMutation({
        mutationFn: async ({ mediaId, favourite }: { mediaId: number, favourite: boolean }) => buildSeaQuery<boolean>({
            serverUrl,
            endpoint: PL.AddMyFavourite.endpoint.replace("{kind}", "ANIME").replace("{refId}", String(mediaId)),
            method: favourite ? "POST" : "DELETE",
            authToken,
        }),
        onSuccess: async (_, v) => {
            await qc.invalidateQueries({ queryKey: [PL.GetMyFavourites.key] })
            toast.success(v.favourite ? "Added to favourites" : "Removed from favourites")
        },
        onError: () => {
            toast.error("Couldn't update your favourites")
        },
    })
}
