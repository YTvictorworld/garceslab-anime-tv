import { TVLibrarySearchScreen } from "@/components/tv/tv-library-search-screen"
import { Redirect } from "expo-router"
import { Platform } from "react-native"

/** The TV's library search (the phone searches the library from its own header). */
export default function LibrarySearchScreen() {
    if (!Platform.isTV) return <Redirect href="/(app)/(tabs)/(library)" />
    return <TVLibrarySearchScreen />
}
